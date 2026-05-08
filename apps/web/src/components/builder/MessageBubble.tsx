// One row in the chat panel. Both `prompt` and `feedback` kinds are user
// messages — they render right-aligned with a violet→cyan gradient bubble
// labeled "You". Any other kind renders left-aligned in the surface tone
// labeled "AI". The list is intentionally short — every other kind is
// reserved for future server-emitted content (e.g. system notes).

interface Message {
  id: string;
  kind: string;
  content: string;
  createdAt: number;
}

export function MessageBubble({ msg, isLast }: { msg: Message; isLast: boolean }) {
  const isUser = msg.kind === "prompt" || msg.kind === "feedback";
  return (
    <div
      style={{
        marginBottom: isLast ? 0 : 16,
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
      }}
    >
      <div
        style={{
          maxWidth: "85%",
          padding: "10px 14px",
          borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
          fontSize: 13,
          lineHeight: 1.55,
          background: isUser
            ? "linear-gradient(135deg, rgba(124,58,237,0.3) 0%, rgba(6,182,212,0.2) 100%)"
            : "var(--color-surface-raised)",
          border: isUser ? "1px solid rgba(124,58,237,0.3)" : "1px solid var(--color-border)",
          color: "var(--color-text-primary)",
          wordBreak: "break-word",
        }}
      >
        {msg.content}
      </div>
      <span
        style={{
          marginTop: 4,
          fontSize: 10,
          color: "var(--color-text-muted)",
          letterSpacing: "0.02em",
        }}
      >
        {isUser ? "You" : "AI"}
      </span>
    </div>
  );
}

export type { Message };
