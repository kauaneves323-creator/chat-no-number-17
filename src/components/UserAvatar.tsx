import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSignedUrl } from "@/lib/media";

export function initialsOf(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function UserAvatar({
  path,
  name,
  className,
}: {
  path?: string | null | undefined;
  name: string;
  className?: string | undefined;
}) {
  const url = useSignedUrl(path);
  return (
    <Avatar className={className}>
      {url && <AvatarImage src={url} alt={name} />}
      <AvatarFallback>{initialsOf(name || "?")}</AvatarFallback>
    </Avatar>
  );
}
