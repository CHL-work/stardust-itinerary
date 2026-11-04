import "./ai-readability.css";

/** Keep model/user text escaped while giving existing paragraph breaks readable spacing. */
export function AiReadableText({ text }: { text: string }) {
  const paragraphs = text.replace(/\r\n?/gu, "\n").split(/\n[\t ]*\n+/u).filter((paragraph) => paragraph.trim());
  return <div className="ai-readable-text">
    {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
  </div>;
}
