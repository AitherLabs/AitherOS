import NextAuth, { AuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080';

export const authOptions: AuthOptions = {
  // Allow NextAuth to operate on whatever host the app is actually served from.
  // Without this, CSRF checks fail when NEXTAUTH_URL doesn't match the request origin.
  // @ts-expect-error trustHost is valid in next-auth v4.22+
  trustHost: true,
  providers: [
    CredentialsProvider({
      name: 'AitherOS',
      credentials: {
        login: { label: 'Username or Email', type: 'text' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.login || !credentials?.password) return null;

        try {
          const res = await fetch(`${API_URL}/api/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              login: credentials.login,
              password: credentials.password
            })
          });

          const json = await res.json();

          if (!res.ok || !json.success) return null;

          const { token, user } = json.data;
          return {
            id: user.id,
            name: user.display_name || user.username,
            email: user.email,
            image: user.avatar_url || null,
            accessToken: token,
            username: user.username,
            role: user.role
          };
        } catch {
          return null;
        }
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.accessToken = (user as any).accessToken;
        token.username = (user as any).username;
        token.role = (user as any).role;
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      (session as any).accessToken = token.accessToken;
      (session as any).user = {
        ...session.user,
        id: token.userId,
        username: token.username,
        role: token.role
      };
      return session;
    }
  },
  pages: {
    signIn: '/auth/sign-in'
  },
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60 // 24 hours
  }
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
