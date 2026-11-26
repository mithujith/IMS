import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '2mb' }));

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured in environment variables.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/ai/chat', async (req, res) => {
  try {
    const { message, history, contextSummary } = req.body as {
      message?: string;
      history?: { role: 'user' | 'model'; text: string }[];
      contextSummary?: unknown;
    };

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'A message string is required.' });
      return;
    }

    const ai = getGeminiClient();
    const systemInstruction = [
      'You are the inventory, sales, and purchasing expert assistant for A & P Brothers (Pvt) Ltd, a motorcycle spare-parts trader in Sri Lanka.',
      'Currency is Sri Lankan Rupees (format as "Rs. 12,500.00"). Units are PCS, SET, BOX, PAIR.',
      'Always base your answers strictly on the provided live JSON summary of stock, sales, purchases, and pending actions.',
      'Be concise, actionable, and specific (mention SKUs, item names, quantities, vendors, or customers when present in the context).',
      'If data is missing or zero, state that clearly without inventing numbers.',
    ].join(' ');

    const promptParts: string[] = [];
    if (contextSummary) {
      promptParts.push(`LIVE ORGANIZATION SNAPSHOT (JSON):\n${JSON.stringify(contextSummary)}`);
    }
    if (Array.isArray(history) && history.length > 0) {
      const formattedHistory = history
        .slice(-8)
        .map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`)
        .join('\n');
      promptParts.push(`RECENT CONVERSATION:\n${formattedHistory}`);
    }
    promptParts.push(`USER QUESTION:\n${message}`);

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: promptParts.join('\n\n'),
      config: {
        systemInstruction,
      },
    });

    res.json({ reply: response.text ?? 'No response generated.' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to reach AI assistant.';
    const status = msg.includes('not configured') ? 503 : 500;
    res.status(status).json({ error: msg });
  }
});

app.post('/api/ai/reorder-suggestions', async (req, res) => {
  try {
    const { lowStockItems, vendors } = req.body as {
      lowStockItems?: Array<{
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
      vendors?: Array<{ id: string; name: string }>;
    };

    if (!Array.isArray(lowStockItems) || lowStockItems.length === 0) {
      res.status(400).json({ error: 'No low-stock items provided.' });
      return;
    }

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Analyze these below-reorder-level motorcycle spare parts and group recommended purchase order quantities by preferred vendor. Prefer each item's preferredVendorId if present, otherwise pick the best matching vendor from the vendor list.\n\nLOW STOCK ITEMS:\n${JSON.stringify(lowStockItems)}\n\nVENDORS:\n${JSON.stringify(vendors ?? [])}`,
      config: {
        systemInstruction:
          'You are an inventory procurement planner for A & P Brothers (Pvt) Ltd. Return structured JSON reorder purchase order suggestions grouped by vendor.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            groups: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  vendorId: { type: Type.STRING },
                  vendorName: { type: Type.STRING },
                  rationale: { type: Type.STRING },
                  items: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        itemId: { type: Type.STRING },
                        sku: { type: Type.STRING },
                        name: { type: Type.STRING },
                        suggestedQty: { type: Type.NUMBER },
                        unitCost: { type: Type.NUMBER },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const raw = (response.text ?? '{}').trim();
    const parsed = JSON.parse(raw);
    res.json(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to generate reorder suggestions.';
    const status = msg.includes('not configured') ? 503 : 500;
    res.status(status).json({ error: msg });
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
