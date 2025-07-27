"use server";

import {prisma} from "@/lib/prisma";
import { auth, currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

export async function syncUser() {
  try {
    const { userId } = await auth();
    const user = await currentUser();

    if (!userId || !user) return null;

    // Try to find the user in the DB
    const existingUser = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    const userData = {
      name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
      username: user.username ?? user.emailAddresses[0].emailAddress.split("@")[0],
      email: user.emailAddresses[0].emailAddress,
      image: user.imageUrl,
    };

    if (existingUser) {
      // Update the user with the latest Clerk data
      const updatedUser = await prisma.user.update({
        where: { clerkId: userId },
        data: userData,
      });
      return updatedUser;
    }

    // If user doesn't exist, create a new record
    const dbUser = await prisma.user.create({
      data: {
        clerkId: userId,
        ...userData,
      },
    });
    revalidatePath("/");
    revalidatePath(`/notifications`);
    revalidatePath(`/profile/${dbUser.username}`);
    return dbUser;
  } catch (error) {
    console.log("Error in syncUser", error);
    return null;
  }
}

export async function getUserByClerkId(clerkId:string) {
  return prisma.user.findUnique({
    where:{
      clerkId:clerkId,
    },
    include:{
      _count:{
        select:{
          followers:true,
          following:true,
          posts:true,
        }
      }
    }
  })
}

export async function getDBUserId() {
  const {userId:clerkId} = await auth();
  if(!clerkId) return null;

  const user = await getUserByClerkId(clerkId);

  if(!user) throw new Error("User not found");

  return user.id;
}

export async function getRandomUsers() {
  try{
    const userId = await getDBUserId();

    if(!userId) return [];
    //Get 3 random users exclude ourseleves and who we are already following
    const randomUsers = await prisma.user.findMany({
      where:{
        AND:[
          {NOT:{id:userId}},
          {
            NOT:{
              followers:{
                some:{
                  followerId:userId
                }
              }
            }
          },
        ]
      },
      select:{
        id:true,
        name: true,
        username: true,
        image: true,
        _count: {
          select:{
            followers:true,
          }
        }
      },
      take:3,
    })

    return randomUsers;
  }catch(error){
    console.log("Error fetching random users", error);
    return [];
  }
}

export async function toggleFollow(targetUserId:string) {
  try {
    const userId = await getDBUserId();

    if(!userId) return;

    if(userId === targetUserId) throw new Error("You cannot follow yourseleves");

    const existingFollow = await prisma.follows.findUnique({
      where:{
        followerId_followingId:{
          followerId:userId,
          followingId:targetUserId 
        }
      }
    })

    if (existingFollow) {
      // unfollow
      await prisma.follows.delete({
        where: {
          followerId_followingId: {
            followerId: userId,
            followingId: targetUserId,
          },
        },
      });
    } else {
      // follow
      await prisma.$transaction([
        prisma.follows.create({
          data: {
            followerId: userId,
            followingId: targetUserId,
          },
        }),

        prisma.notification.create({
          data: {
            type: "FOLLOW",
            userId: targetUserId, // user being followed
            creatorId: userId, // user following
          },
        }),
      ]);
    }
    revalidatePath("/");
    return {success:true}
  } catch (error) {
    console.log("Error in toggleFollow", error);
    return {success:false,error:"Error toggling follow"}
  }
}