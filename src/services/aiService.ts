export interface AiChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface ReorderSuggestionGroup {
  vendorId: string;
  vendorName: string;
  rationale: string;
  items: {
    itemId: string;
    sku: string;
    name: string;
    suggestedQty: number;
    unitCost: number;
  }[];
}

export interface ReorderSuggestionsResponse {
  summary: string;
  groups: ReorderSuggestionGroup[];
}

export async function sendAiChatQuery(params: {
  message: string;
  history: AiChatMessage[];
  contextSummary: unknown;
}): Promise<string> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = (await res.json()) as { reply?: string; error?: string };
  if (!res.ok) {
    throw new Error(data.error || `AI request failed (${res.status}).`);
  }
  return data.reply || 'No response generated.';
}

export async function fetchAiReorderSuggestions(params: {
  lowStockItems: Array<{
    id: string;
    sku: string;
    name: string;
    unit: string;
    totalStock: number;
    reorderLevel: number;
    reorderQty: number;
    costPrice: number;
    preferredVendorId?: string;
  }>;
  vendors: Array<{ id: string; name: string }>;
}): Promise<ReorderSuggestionsResponse> {
  const res = await fetch('/api/ai/reorder-suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = (await res.json()) as ReorderSuggestionsResponse & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Reorder suggestion request failed (${res.status}).`);
  }
  return data;
}
