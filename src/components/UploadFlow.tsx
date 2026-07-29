"use client";

import React, { useState } from "react";

import { useApiError } from "../hooks/useApiError";
import type { ColumnMapping, ConfirmedMapping, FreeSummary, RawRow } from "../types/pipeline";
import { ErrorModal } from "./ErrorModal";
import { FreeSummaryCards } from "./FreeSummaryCards";
import { PasswordPrompt } from "./PasswordPrompt";
import { PremiumSection } from "./PremiumSection";
import { Button } from "./ui/button";

interface UploadFlowProps {
  isSubscribed: boolean;
}

interface UploadSample {
  headers: string[];
  rows: RawRow[];
  excludedColumns: string[];
  maskedColumns: string[];
}

interface UploadResponse {
  mapping: ColumnMapping;
  sample: UploadSample;
}

interface AnalyzeResponse {
  analysisId: string;
  freeSummary: FreeSummary;
}

type Step = "idle" | "confirming" | "done";
type MappingField = keyof ConfirmedMapping;
type PasswordPromptReason = "missing" | "incorrect";

const FIELD_LABELS: Record<MappingField, string> = {
  date: "날짜 컬럼",
  merchant: "가맹점 컬럼",
  amount: "금액 컬럼",
  category: "카테고리 컬럼",
};

export function UploadFlow({ isSubscribed }: UploadFlowProps) {
  const [step, setStep] = useState<Step>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [sample, setSample] = useState<UploadSample | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [fileValidationMessage, setFileValidationMessage] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [passwordPrompt, setPasswordPrompt] = useState<{
    reason: PasswordPromptReason;
  } | null>(null);
  const { error, isOpen, handleResponse, close } = useApiError();

  function isSupportedFile(selectedFile: File) {
    const extension = selectedFile.name.toLowerCase().split(".").pop();
    return (
      extension === "csv" ||
      extension === "pdf" ||
      selectedFile.type === "text/csv" ||
      selectedFile.type === "application/pdf"
    );
  }

  function selectFile(selectedFile: File) {
    if (!isSupportedFile(selectedFile)) {
      setFileValidationMessage("CSV 또는 PDF 파일만 올릴 수 있어요.");
      return;
    }
    setFileValidationMessage(null);
    void upload(selectedFile);
  }

  async function upload(selectedFile: File, submittedPassword?: string) {
    setFile(selectedFile);
    setIsWorking(true);
    const body = new FormData();
    body.append("file", selectedFile);
    if (submittedPassword) {
      body.append("password", submittedPassword);
    }

    try {
      const response = await fetch("/api/upload", { method: "POST", body });
      if (!response.ok && response.status === 409) {
        const passwordError = (await response
          .clone()
          .json()
          .catch(() => null)) as { code?: unknown; reason?: unknown } | null;
        if (passwordError?.code === "PDF_PASSWORD_REQUIRED") {
          const reason: PasswordPromptReason =
            passwordError.reason === "incorrect" ? "incorrect" : "missing";
          if (reason === "incorrect") {
            setPassword("");
          }
          setPasswordPrompt({ reason });
          return;
        }
      }
      if (await handleResponse(response)) return;
      const data = (await response.json()) as UploadResponse;
      setMapping(data.mapping);
      setSample(data.sample);
      setPasswordPrompt(null);
      setStep("confirming");
    } catch {
      await handleResponse(new Response("", { status: 500 }));
    } finally {
      setIsWorking(false);
    }
  }

  function reset() {
    setStep("idle");
    setFile(null);
    setSample(null);
    setMapping(null);
    setResult(null);
    setFileValidationMessage(null);
    if (password) {
      setPassword("");
    }
    setPasswordPrompt(null);
  }

  function updateMapping(field: MappingField, value: string) {
    setMapping((current) =>
      current ? { ...current, [field]: value === "" ? null : value } : current,
    );
  }

  async function analyze() {
    if (!file || !mapping?.date || !mapping.merchant || !mapping.amount) return;
    const confirmed: ConfirmedMapping = {
      date: mapping.date,
      merchant: mapping.merchant,
      amount: mapping.amount,
      category: mapping.category,
    };
    const body = new FormData();
    body.append("file", file);
    body.append("mapping", JSON.stringify(confirmed));
    setIsWorking(true);

    try {
      const response = await fetch("/api/analyze", { method: "POST", body });
      if (await handleResponse(response)) return;
      const data = (await response.json()) as AnalyzeResponse;
      setResult(data);
      setStep("done");
    } catch {
      await handleResponse(new Response("", { status: 500 }));
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl text-left">
      {step === "idle" && !passwordPrompt ? (
        <section
          className={`rounded-[24px] border-2 border-dashed bg-[#16181c] p-8 transition-colors sm:p-10 ${
            isDragging ? "border-[#0052ff] bg-[rgba(0,82,255,0.06)]" : "border-[#2a2d33]"
          }`}
          data-testid="upload-card"
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            const droppedFile = event.dataTransfer.files[0];
            if (droppedFile) selectFile(droppedFile);
          }}
        >
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[rgba(0,82,255,0.15)] text-[#0052ff]">
              <UploadIcon />
            </span>
            <div>
              <h2 className="text-2xl font-semibold text-white">
                거래내역 CSV·카드 명세서 PDF 업로드
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[#a8acb3]">
                거래내역 CSV나 카드사에서 받은 명세서 PDF를 올릴 수 있어요. 원본 파일은
                저장하지 않아요.
              </p>
            </div>
          </div>

          <label className="mt-8 inline-flex h-14 cursor-pointer items-center rounded-full bg-[#0052ff] px-8 font-semibold text-white hover:bg-[#003ecc]">
            파일 선택
            <input
              accept=".csv,text/csv,.pdf,application/pdf"
              aria-label="CSV 또는 PDF 파일 선택"
              className="sr-only"
              disabled={isWorking}
              onChange={(event) => {
                const selectedFile = event.target.files?.[0];
                if (selectedFile) selectFile(selectedFile);
              }}
              type="file"
            />
          </label>
          {fileValidationMessage ? (
            <p className="mt-4 text-sm text-[#cf202f]">{fileValidationMessage}</p>
          ) : isWorking ? (
            <p className="mt-4 animate-fade-in text-sm text-[#a8acb3]">파일을 확인하고 있어요...</p>
          ) : (
            <p className="mt-6 text-[13px] leading-relaxed text-[#6e7480]">
              CSV가 없나요? 카드사·은행 앱 → 이용내역 → 내보내기(CSV)에서 받을 수 있어요.
            </p>
          )}
        </section>
      ) : null}

      <PasswordPrompt
        isOpen={passwordPrompt !== null}
        isWorking={isWorking}
        onCancel={reset}
        onSubmit={(submittedPassword) => {
          if (!file) return;
          setPassword(submittedPassword);
          void upload(file, submittedPassword);
        }}
        reason={passwordPrompt?.reason ?? "missing"}
      />

      {step === "confirming" && sample && mapping ? (
        <section className="rounded-[24px] bg-[#16181c] p-8" data-testid="mapping-card">
          <h2 className="text-2xl font-semibold text-white">컬럼 매핑 확인</h2>
          <p className="mt-3 text-sm text-[#a8acb3]">분석에 사용할 컬럼이 맞는지 확인해 주세요.</p>
          {mapping.confidence < 0.7 ? (
            <div className="mt-4 flex items-start gap-3 rounded-xl bg-[#0a0b0d] p-4">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgba(91,139,255,0.15)] text-[10px] font-semibold text-[#5b8bff]"
              >
                !
              </span>
              <p className="text-sm text-[#5b8bff]">
                자동 매핑의 확신도가 낮아요. 매핑 결과를 한 번 더 확인해 주세요.
              </p>
            </div>
          ) : null}

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {(Object.keys(FIELD_LABELS) as MappingField[]).map((field) => (
              <label className="text-sm text-[#a8acb3]" key={field}>
                {FIELD_LABELS[field]}
                <select
                  aria-label={FIELD_LABELS[field]}
                  className="mt-2 w-full rounded-xl border border-[#2a2d33] bg-[#16181c] px-4 py-3 text-white"
                  onChange={(event) => updateMapping(field, event.target.value)}
                  value={mapping[field] ?? ""}
                >
                  {field === "category" ? <option value="">선택하지 않음</option> : <option value="">선택하세요</option>}
                  {sample.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                </select>
              </label>
            ))}
          </div>

          <div className="mt-8 overflow-x-auto rounded-xl bg-[#0a0b0d]">
            <table className="w-full text-left text-sm">
              <thead><tr>{sample.headers.map((header) => <th className="whitespace-nowrap p-4 font-medium text-[#a8acb3]" key={header}>{header}</th>)}</tr></thead>
              <tbody>{sample.rows.map((row, index) => <tr key={index}>{sample.headers.map((header) => <td className="whitespace-nowrap border-t border-[#2a2d33] p-4 text-white" key={header}>{row[header]}</td>)}</tr>)}</tbody>
            </table>
          </div>

          <div className="mt-6 flex items-start gap-3 rounded-xl bg-[#0a0b0d] p-4">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgba(5,177,105,0.15)] text-[#05b169]">
              <ShieldIcon />
            </span>
            <div className="space-y-1.5 text-sm text-[#a8acb3]">
              {sample.excludedColumns.length ? <p>{sample.excludedColumns.join("·")}는 전송되지 않았어요</p> : null}
              {sample.maskedColumns.length ? <p>{sample.maskedColumns.join("·")}는 뒤 4자리만 남겼어요</p> : null}
            </div>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button disabled={isWorking || !mapping.date || !mapping.merchant || !mapping.amount} onClick={() => void analyze()} type="button">
              {isWorking ? "분석 중..." : "분석 시작"}
            </Button>
            <Button disabled={isWorking} onClick={reset} type="button" variant="secondary">다시 올리기</Button>
          </div>
        </section>
      ) : null}

      {step === "done" && result ? (
        <div className="slide-up space-y-8">
          <FreeSummaryCards summary={result.freeSummary} />
          <PremiumSection analysisId={result.analysisId} isSubscribed={isSubscribed} />
        </div>
      ) : null}

      <ErrorModal isOpen={isOpen} message={error?.message} onClose={close} />
    </div>
  );
}

function UploadIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="22"
      viewBox="0 0 22 22"
      width="22"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M11 14V3.5M11 3.5 7 7.5M11 3.5l4 4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M4 13.5v2a2.5 2.5 0 0 0 2.5 2.5h9a2.5 2.5 0 0 0 2.5-2.5v-2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      viewBox="0 0 20 20"
      width="14"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M10 2.5 4 5v4.5c0 3.4 2.4 6.3 6 7.5 3.6-1.2 6-4.1 6-7.5V5l-6-2.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="m7.6 9.8 1.7 1.7 3.1-3.4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}
