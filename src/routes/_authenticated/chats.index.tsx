import { createFileRoute } from "@tanstack/react-router";
import logo from "@/assets/logo.png";

export const Route = createFileRoute("/_authenticated/chats/")({
  component: ChatsEmpty,
});

function ChatsEmpty() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-chat-canvas px-8 text-center">
      <img src={logo} alt="" width={512} height={512} className="h-16 w-16 opacity-70" />
      <h2 className="text-xl font-semibold">Suas conversas ficam aqui</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Escolha uma conversa à esquerda ou comece uma nova buscando pelo nome de usuário de alguém.
      </p>
    </div>
  );
}
