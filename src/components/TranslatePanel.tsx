import { useState, useCallback } from "react";
import { invokeEdgeFunction } from "../api";
import { useT } from "../i18n";
import { useUiStore } from "../stores/uiStore";

const LANGUAGES = [
  "English", "Swedish", "Finnish", "German", "French", "Spanish",
  "Norwegian", "Danish", "Dutch", "Portuguese", "Japanese",
  "Chinese (Simplified)", "Korean", "Arabic", "Russian", "Polish", "Italian",
];

const STORAGE_KEY = "easyvault_translate_lang";
const CHUNK_SIZE = 7500;

function getStoredLang(): string {
  return localStorage.getItem(STORAGE_KEY) || "English";
}

function splitAtParagraphs(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    let cut = remaining.lastIndexOf("\n\n", maxLen);
    if (cut < maxLen * 0.3) cut = remaining.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.3) cut = remaining.lastIndexOf(" ", maxLen);
    if (cut < maxLen * 0.3) cut = maxLen;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n+/, "");
  }
  return chunks;
}

interface Props {
  sourceText: string;
  isExtracting: boolean;
  extractError: string;
  onClose: () => void;
}

export default function TranslatePanel({ sourceText, isExtracting, extractError, onClose }: Props) {
  const t = useT();
  const setStatus = useUiStore((s) => s.setStatus);
  const [targetLang, setTargetLang] = useState(getStoredLang);
  const [translatedText, setTranslatedText] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const handleLangChange = useCallback((lang: string) => {
    setTargetLang(lang);
    localStorage.setItem(STORAGE_KEY, lang);
  }, []);

  const handleTranslate = useCallback(async () => {
    if (!sourceText.trim()) { setError(t("translate.noText")); return; }
    setIsTranslating(true);
    setError("");
    setTranslatedText("");
    setProgress(t("translate.translating"));

    try {
      const chunks = splitAtParagraphs(sourceText, CHUNK_SIZE);
      const results: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        if (chunks.length > 1) {
          setProgress(t("translate.chunkProgress", { current: String(i + 1), total: String(chunks.length) }));
        }
        const res = await invokeEdgeFunction<{ translated_text: string }>("translateText", {
          text: chunks[i],
          target_language: targetLang,
        });
        results.push(res.translated_text);
      }

      setTranslatedText(results.join("\n\n"));
      setProgress(t("translate.done"));
    } catch (err) {
      setError(t("translate.failed", { error: String(err) }));
      setProgress("");
    } finally {
      setIsTranslating(false);
    }
  }, [sourceText, targetLang, t]);

  const handleCopy = useCallback(() => {
    if (!translatedText) return;
    void navigator.clipboard.writeText(translatedText).then(() => {
      setStatus(t("translate.copied"));
    });
  }, [translatedText, setStatus, t]);

  return (
    <div className="translate-panel">
      <div className="translate-panel-header">
        <span>{t("translate.title")}</span>
        <button type="button" className="ghost translate-close-btn" onClick={onClose}>&#x2715;</button>
      </div>

      <label className="translate-panel-label">{t("translate.targetLang")}</label>
      <select value={targetLang} onChange={(e) => handleLangChange(e.target.value)}>
        {LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>{lang}</option>
        ))}
      </select>

      <div className="translate-btn-row">
        <button
          type="button"
          onClick={handleTranslate}
          disabled={isTranslating || isExtracting || !sourceText.trim()}
        >
          {isTranslating ? t("translate.translating") : t("translate.translate")}
        </button>
        {translatedText && (
          <button type="button" className="ghost" onClick={handleCopy}>{t("translate.copy")}</button>
        )}
      </div>

      {(isExtracting || progress || error || extractError) && (
        <p className={`translate-panel-status${error || extractError ? " status-error" : ""}`}>
          {isExtracting ? t("translate.extracting") : error || extractError || progress}
        </p>
      )}

      {translatedText && (
        <div className="translate-panel-output">{translatedText}</div>
      )}

      {!translatedText && !isTranslating && !isExtracting && sourceText && (
        <div className="translate-panel-source">
          <p className="translate-panel-source-label">Source text ({sourceText.length.toLocaleString()} chars)</p>
          <div className="translate-panel-output translate-panel-source-preview">
            {sourceText.slice(0, 500)}{sourceText.length > 500 ? "..." : ""}
          </div>
        </div>
      )}
    </div>
  );
}
