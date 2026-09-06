import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "media";
const cache = new Map<string, string>();

export async function uploadMedia(
  file: Blob,
  userId: string,
  folder: "avatars" | "chat" | "stories",
  ext: string,
) {
  const path = `${userId}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function getSignedUrl(path: string) {
  const cached = cache.get(path);
  if (cached) return cached;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 6);
  if (!data?.signedUrl) return null;
  cache.set(path, data.signedUrl);
  return data.signedUrl;
}

export function useSignedUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(() => (path ? cache.get(path) ?? null : null));

  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    let active = true;
    void getSignedUrl(path).then((next) => {
      if (active) setUrl(next);
    });
    return () => {
      active = false;
    };
  }, [path]);

  return url;
}

export function extensionOf(file: File, fallback: string) {
  const match = /\.([a-z0-9]+)$/i.exec(file.name);
  return match?.[1]?.toLowerCase() ?? fallback;
}
