"use client";

import { useCallback, useState } from "react";

const DEFAULT_MESSAGE = "문제가 발생했어요. 잠시 후 다시 시도해 주세요.";

const ERROR_MESSAGES: Record<string, string> = {
  PAYWALL_REQUIRED: "이 리포트는 Premium 구독에서 확인할 수 있어요.",
  NOT_FOUND: "요청하신 분석을 찾을 수 없어요. 다시 시도해 주세요.",
  GENERATION_FAILED: "리포트를 생성하지 못했어요. 잠시 후 다시 시도해 주세요.",
  BAD_REQUEST: "파일을 읽지 못했어요. CSV 형식을 확인해 주세요.",
};

interface ApiErrorBody {
  code?: unknown;
}

export interface ApiError {
  message: string;
}

export function useApiError() {
  const [error, setError] = useState<ApiError | null>(null);

  const handleResponse = useCallback(async (response: Response) => {
    if (response.ok) {
      return false;
    }

    let message = DEFAULT_MESSAGE;

    try {
      const body = (await response.json()) as ApiErrorBody;
      if (typeof body.code === "string") {
        message = ERROR_MESSAGES[body.code] ?? DEFAULT_MESSAGE;
      }
    } catch {
      // A malformed error response is intentionally reduced to the safe default.
    }

    setError({ message });
    return true;
  }, []);

  const close = useCallback(() => {
    setError(null);
  }, []);

  return {
    error,
    isError: error !== null,
    isOpen: error !== null,
    handleResponse,
    close,
  };
}
