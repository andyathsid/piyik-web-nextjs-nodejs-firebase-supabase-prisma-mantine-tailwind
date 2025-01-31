'use server'

import { RegisterFormSchema, LoginFormSchema } from "@/lib/auth/rules";
import { auth } from "@/lib/firebase/client";
import { createSessionCookie } from "@/lib/auth/sessions";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { PrismaClient } from '@prisma/client';
import { adminAuth } from "@/lib/firebase/admin";


const prisma = new PrismaClient();

export async function Register(
  state: { errors: { name?: string[]; email?: string[]; password?: string[]; confirmPassword?: string[]; }; email: string; name: string; generalError: string; success: boolean; } | undefined,
  formData: FormData
) {
  const validatedFields = RegisterFormSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      email: formData.get("email") as string,
      name: formData.get("name") as string,
      generalError: "Registration failed. Please try again later.",
      success: false
    };
  }

  const { name, email, password } = validatedFields.data;

  try {
    // Create Firebase user
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

    // Create session token
    const idToken = await userCredential.user.getIdToken();
    if (!idToken) {
      throw new Error("Failed to get ID token");
    }

    // Create Prisma user record
    await prisma.user.create({
      data: {
        id: userCredential.user.uid,
        email: email,
        name: name,
      },
    });

    // Create session cookie
    const { success, error } = await createSessionCookie(idToken);
    if (!success) {
      throw new Error(error);
    }

    return { 
      errors: {},
      email: '',
      name: '',
      generalError: "",
      success: true
    };
  } catch (error: any) {
    console.error('Registration error:', error);

    // Clean up if Prisma user was created but session failed
    if (error.message === "Failed to create session" && error?.uid) {
      await prisma.user.delete({
        where: { id: error.uid }
      }).catch(console.error);
    }

    if (error.code === 'auth/email-already-in-use') {
      return {
        errors: {
          email: ["This email is already registered. Please try logging in."]
        },
        email,
        name,
        generalError: "",
        success: false
      };
    }

    return {
      errors: {},
      email: email || '',
      name: name || '',
      generalError: "Registration failed. Please try again later.",
      success: false
    };
  } finally {
    await prisma.$disconnect();
  }
}

export async function Login(
  state: { errors: { email?: string[]; password?: string[]; }; email: string; generalError: string; } | undefined,
  formData: FormData
) {
  const validatedFields = LoginFormSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    remember: formData.get("remember") === "on",
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      email: formData.get("email") as string,
      generalError: "Login failed. Please check your credentials.",
      success: false
    };
  }

  const { email, password, remember } = validatedFields.data;

  try {
    // Sign in with Firebase
    const userCredential = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );

    // Get the ID token
    const idToken = await userCredential.user.getIdToken();
    if (!idToken) {
      throw new Error("Failed to get ID token");
    }

    // Create session cookie
    const { success, error } = await createSessionCookie(idToken);
    if (!success) {
      throw new Error(error);
    }

    return { 
      errors: {},
      email: '',
      generalError: "",
      success: true 
    };
  } catch (error: any) {
    console.error('Login error:', error);

    if (error.code === 'auth/invalid-credential') {
      return {
        errors: {
          password: ["Invalid email or password"]
        },
        email,
        generalError: "",
        success: false
      };
    }

    return {
      errors: {},
      email: email || '',
      generalError: "Login failed. Please try again later.",
      success: false
    };
  } 

}

export async function GoogleLogin(idToken: string, state: { success: boolean; error: string;} | undefined) {
  try {
    // Create session cookie
    const { success, error, uid } = await createSessionCookie(idToken);
    if (!success) {
      throw new Error(error);
    }

    // Check if user exists in Prisma
    let user = await prisma.user.findUnique({
      where: { id: uid }
    });

    // If user doesn't exist, create them
    if (!user) {
      const firebaseUser = await adminAuth.getUser(uid as string);
      user = await prisma.user.create({
        data: {
          id: uid as string,
          email: firebaseUser.email!,
          name: firebaseUser.displayName || firebaseUser.email!.split('@')[0],
        },
      });
    }

    return {
      success: true,
      error: '', 
    };
  } catch (error: any) {
    console.error('Google login error:', error);
    return {
      success: false,
      error: "Failed to login with Google. Please try again."
    };
  } finally {
    await prisma.$disconnect();
  }
}