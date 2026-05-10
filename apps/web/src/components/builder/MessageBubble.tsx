// One row in the chat panel.
//
//  - `prompt` and `feedback` kinds are user messages — they render
//    right-aligned with a violet→cyan gradient bubble labeled "You".
//  - `summary` kind is an AI-generated diff recap after a refinement. It
//    renders left-aligned in surface tone with a "Changes" label and a
//    leading sparkle icon to distinguish it from a future plain "AI"
//    bubble. Italic body so it visually nests under the user feedback
//    that triggered it.
//  - Any other future kind also renders left-aligned in surface tone
//    with a generic "AI" label.

import { Sparkles } from "lucide-react";

interface Message {
  id: string;
  kind: string;
  content: string;
  createdAt: number;
}

export function MessageBubble({ msg, isLast }: { msg: Message; isLast: boolean }) {
  const isUser = msg.kind === "prompt" || msg.kind === "feedback";
  const isSummary = msg.kind === "summary";
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
            : isSummary
              ? "linear-gradient(135deg, rgba(124,58,237,0.06) 0%, rgba(6,182,212,0.06) 100%)"
              : "var(--color-surface-raised)",
          border: isUser
            ? "1px solid rgba(124,58,237,0.3)"
            : isSummary
              ? "1px solid rgba(124,58,237,0.18)"
              : "1px solid var(--color-border)",
          color: isSummary ? "var(--color-text-secondary)" : "var(--color-text-primary)",
          wordBreak: "break-word",
          fontStyle: isSummary ? "italic" : "normal",
          display: "flex",
          gap: 8,
          alignItems: "flex-start",
        }}
      >
        {isSummary && (
          <Sparkles
            size={12}
            strokeWidth={1.8}
            style={{
              flexShrink: 0,
              marginTop: 3,
              color: "rgba(167,139,250,0.7)",
            }}
          />
        )}
        <span>{msg.content}</span>
      </div>
      <span
        style={{
          marginTop: 4,
          fontSize: 10,
          color: "var(--color-text-muted)",
          letterSpacing: "0.02em",
        }}
      >
        {isUser ? "You" : isSummary ? "Changes" : "AI"}
      </span>
    </div>
  );
}

export type { Message };
