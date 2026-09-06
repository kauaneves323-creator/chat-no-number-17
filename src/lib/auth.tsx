import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  about: string;
};

type AuthValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function normalizeUsername(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

function syntheticEmail(username: string) {
  return `${username}@zapzap.app`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data: { session: current } }) => {
      setSession(current);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      return;
    }
    let active = true;
    supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, about")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setProfile((data as Profile) ?? null);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      refreshProfile: async () => {
        if (!userId) return;
        const { data } = await supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url, about")
          .eq("id", userId)
          .maybeSingle();
        setProfile((data as Profile) ?? null);
      },
      signIn: async (username, password) => {
        const clean = normalizeUsername(username);
        const { error } = await supabase.auth.signInWithPassword({
          email: syntheticEmail(clean),
          password,
        });
        if (error) throw new Error("Nome de usuário ou senha incorretos.");
      },
      signUp: async (username, password, displayName) => {
        const clean = normalizeUsername(username);
        const { error } = await supabase.auth.signUp({
          email: syntheticEmail(clean),
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { username: clean, display_name: displayName.trim() || clean },
          },
        });
        if (error) {
          if (/already registered|already exists/i.test(error.message)) {
            throw new Error("Esse nome de usuário já está em uso.");
          }
          throw new Error(error.message);
        }
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [session, profile, loading, userId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de AuthProvider");
  return ctx;
}
