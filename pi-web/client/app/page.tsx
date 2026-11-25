import { Suspense } from "react";
import { Chat } from "@/chat/Chat";

export default function Home() {
  return (
    <Suspense>
      <Chat />
    </Suspense>
  );
}
