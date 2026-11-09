const asText = (value) => String(value || '').trim();

export const isRequestCanceled = (error) => {
  const code = asText(error?.code).toUpperCase();
  const name = asText(error?.name);
  return (
    code === 'ERR_CANCELED' ||
    name === 'CanceledError' ||
    name === 'AbortError'
  );
};

const getStatus = (error) => {
  const directStatus = Number(error?.response?.status ?? error?.status);
  return Number.isFinite(directStatus) && directStatus > 0 ? directStatus : null;
};

export const classifyRequestError = (error, options = {}) => {
  const {
    apiBaseUrl = '',
    fallbackMessage = 'Request failed. Please try again.',
    timeoutMessage = 'Request timed out. Please retry.',
    networkMessage,
    corsMessage,
  } = options;

  if (isRequestCanceled(error)) {
    return { kind: 'canceled', message: '', status: null };
  }

  const status = getStatus(error);
  const backendMessage = asText(error?.response?.data?.error);
  const message = asText(error?.message);
  const combined = `${backendMessage} ${message}`.toLowerCase();

  if (status === 504 || combined.includes('timed out') || combined.includes('timeout')) {
    return {
      kind: 'timeout',
      status,
      message: timeoutMessage,
    };
  }

  if (combined.includes('cors') || combined.includes('origin')) {
    return {
      kind: 'cors',
      status,
      message:
        corsMessage ||
        `Backend blocked this origin (CORS). Verify backend allowlist settings${apiBaseUrl ? ` for ${apiBaseUrl}` : ''}.`,
    };
  }

  if (
    !status &&
    (
      error?.isNetworkError ||
      combined.includes('network error') ||
      combined.includes('failed to fetch') ||
      combined.includes('load failed') ||
      combined.includes('cannot reach')
    )
  ) {
    return {
      kind: 'network',
      status: null,
      message:
        networkMessage ||
        `Cannot reach backend API${apiBaseUrl ? ` (${apiBaseUrl})` : ''}. Check connection/CORS settings and try again.`,
    };
  }

  if (backendMessage) {
    return { kind: 'backend', status, message: backendMessage };
  }

  if (status) {
    return { kind: 'backend', status, message: `${fallbackMessage} (HTTP ${status})` };
  }

  return { kind: 'unknown', status: null, message: message || fallbackMessage };
};
