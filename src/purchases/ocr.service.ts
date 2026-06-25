import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../inventory/entities/product.entity';
import * as https from 'https';
import * as http from 'http';

export interface OcrLineItem {
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  confidence: number; // 0–1 from Azure
  matchedProduct: {
    id: string;
    name: string;
    nameAr?: string;
    sku?: string;
    matchScore: number; // 0–100 fuzzy score
  } | null;
}

export interface OcrResult {
  vendorName: string | null;
  vendorNameConfidence: number;
  invoiceId: string | null;
  invoiceIdConfidence: number;
  invoiceDate: string | null;
  invoiceDateConfidence: number;
  totalAmount: number | null;
  totalAmountConfidence: number;
  lineItems: OcrLineItem[];
  rawApiResponse?: any;
  error?: string;
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
  ) {}

  async analyzeInvoice(fileBuffer: Buffer, mimeType: string, _tenantId?: string): Promise<OcrResult> {
    const endpoint = process.env.AZURE_FORM_RECOGNIZER_ENDPOINT;
    const key      = process.env.AZURE_FORM_RECOGNIZER_KEY;

    if (!endpoint || !key) {
      // Return a graceful empty result when not configured — dev/test mode
      this.logger.warn('Azure Form Recognizer not configured — returning empty OCR result. Set AZURE_FORM_RECOGNIZER_ENDPOINT and AZURE_FORM_RECOGNIZER_KEY.');
      return {
        vendorName: null, vendorNameConfidence: 0,
        invoiceId: null, invoiceIdConfidence: 0,
        invoiceDate: null, invoiceDateConfidence: 0,
        totalAmount: null, totalAmountConfidence: 0,
        lineItems: [],
        error: 'OCR_NOT_CONFIGURED',
      };
    }

    try {
      // 1. Submit analysis job (async operation pattern)
      const operationLocation = await this.submitAnalysis(endpoint, key, fileBuffer, mimeType);

      // 2. Poll for result (max 30s, 2s interval)
      const apiResult = await this.pollResult(operationLocation, key);

      // 3. Parse Azure response into OcrResult
      const parsed = this.parseAzureResult(apiResult);

      // 4. Fuzzy-match line items to product catalog
      parsed.lineItems = await this.matchLineItems(parsed.lineItems);

      return parsed;
    } catch (err: any) {
      this.logger.error('OCR analysis failed', err?.message);
      return {
        vendorName: null, vendorNameConfidence: 0,
        invoiceId: null, invoiceIdConfidence: 0,
        invoiceDate: null, invoiceDateConfidence: 0,
        totalAmount: null, totalAmountConfidence: 0,
        lineItems: [],
        error: err?.message || 'OCR_FAILED',
      };
    }
  }

  private submitAnalysis(endpoint: string, key: string, buffer: Buffer, mimeType: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${endpoint.replace(/\/$/, '')}/formrecognizer/documentModels/prebuilt-invoice:analyze?api-version=2023-07-31`);
      const useHttps = url.protocol === 'https:';
      const mod = useHttps ? https : http;

      const req = mod.request(
        {
          hostname: url.hostname,
          port: url.port || (useHttps ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': key,
            'Content-Type': mimeType || 'application/octet-stream',
            'Content-Length': buffer.length,
          },
        },
        (res) => {
          let body = '';
          res.on('data', c => (body += c));
          res.on('end', () => {
            if (res.statusCode === 202) {
              const opLoc = res.headers['operation-location'];
              if (!opLoc) return reject(new Error('Missing Operation-Location header'));
              resolve(opLoc as string);
            } else {
              reject(new Error(`Azure submit failed: ${res.statusCode} ${body.slice(0, 200)}`));
            }
          });
        },
      );
      req.on('error', reject);
      req.write(buffer);
      req.end();
    });
  }

  private pollResult(operationLocation: string, key: string, maxMs = 30_000): Promise<any> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const attempt = () => {
        const url = new URL(operationLocation);
        const useHttps = url.protocol === 'https:';
        const mod = useHttps ? https : http;

        const req = mod.request(
          {
            hostname: url.hostname,
            port: url.port || (useHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: 'GET',
            headers: { 'Ocp-Apim-Subscription-Key': key },
          },
          (res) => {
            let body = '';
            res.on('data', c => (body += c));
            res.on('end', () => {
              try {
                const json = JSON.parse(body);
                if (json.status === 'succeeded') return resolve(json);
                if (json.status === 'failed')    return reject(new Error('Azure analysis failed'));
                if (Date.now() - started > maxMs) return reject(new Error('OCR timeout'));
                setTimeout(attempt, 2_000);
              } catch {
                reject(new Error('Invalid poll response'));
              }
            });
          },
        );
        req.on('error', reject);
        req.end();
      };
      attempt();
    });
  }

  private parseAzureResult(apiResult: any): OcrResult {
    const doc = apiResult?.analyzeResult?.documents?.[0];
    const fields = doc?.fields ?? {};

    const getField = (name: string) => fields[name];
    const getContent = (f: any): string | null => f?.content ?? f?.valueString ?? null;
    const getNumber  = (f: any): number | null => f?.valueNumber ?? null;
    const getConf    = (f: any): number => f?.confidence ?? 0;
    const getDate    = (f: any): string | null => {
      if (!f) return null;
      if (f.valueDate) return f.valueDate; // "2026-03-15"
      if (f.content)   return f.content;
      return null;
    };

    const vendorF    = getField('VendorName');
    const invoiceF   = getField('InvoiceId');
    const dateF      = getField('InvoiceDate');
    const totalF     = getField('InvoiceTotal');
    const itemsField = getField('Items');

    const lineItems: OcrLineItem[] = [];

    if (itemsField?.valueArray) {
      for (const item of itemsField.valueArray) {
        const iv = item.valueObject ?? {};
        const desc  = getContent(iv.Description)    ?? getContent(iv.ProductCode) ?? '';
        const qty   = getNumber(iv.Quantity)         ?? null;
        const price = getNumber(iv.UnitPrice)        ?? null;
        const amt   = getNumber(iv.Amount)           ?? null;
        const conf  = getConf(item);

        lineItems.push({
          description: desc,
          quantity:    qty,
          unitPrice:   price,
          amount:      amt,
          confidence:  conf,
          matchedProduct: null, // filled in matchLineItems
        });
      }
    }

    return {
      vendorName:           getContent(vendorF),
      vendorNameConfidence: getConf(vendorF),
      invoiceId:            getContent(invoiceF),
      invoiceIdConfidence:  getConf(invoiceF),
      invoiceDate:          getDate(dateF),
      invoiceDateConfidence: getConf(dateF),
      totalAmount:          getNumber(totalF),
      totalAmountConfidence: getConf(totalF),
      lineItems,
    };
  }

  private async matchLineItems(items: OcrLineItem[]): Promise<OcrLineItem[]> {
    if (!items.length) return items;

    // Load a broad product set for matching (max 500 active products)
    const products = await this.productRepo
      .createQueryBuilder('p')
      .select(['p.id', 'p.name', 'p.nameAr', 'p.sku', 'p.genericName', 'p.activeIngredient'])
      .where('p."isActive" = true OR p."isActive" IS NULL')
      .limit(500)
      .getMany();

    return items.map(item => ({
      ...item,
      matchedProduct: this.fuzzyMatch(item.description, products),
    }));
  }

  private fuzzyMatch(
    query: string,
    products: Pick<Product, 'id' | 'name' | 'nameAr' | 'sku' | 'genericName' | 'activeIngredient'>[],
  ): OcrLineItem['matchedProduct'] {
    if (!query?.trim() || !products.length) return null;

    const q = query.toLowerCase().trim();

    let best: { product: typeof products[0]; score: number } | null = null;

    for (const p of products) {
      const candidates = [p.name, p.nameAr, p.genericName, p.activeIngredient, p.sku]
        .filter(Boolean)
        .map(s => s!.toLowerCase());

      let score = 0;
      for (const c of candidates) {
        if (c === q)                               { score = Math.max(score, 100); break; }
        if (c.startsWith(q) || q.startsWith(c))   { score = Math.max(score, 90); }
        else if (c.includes(q) || q.includes(c))  { score = Math.max(score, 75); }
        else {
          // Bigram overlap
          const bigrams = (s: string) => {
            const b = new Set<string>();
            for (let i = 0; i < s.length - 1; i++) b.add(s.slice(i, i + 2));
            return b;
          };
          const bg1 = bigrams(q);
          const bg2 = bigrams(c);
          const intersection = [...bg1].filter(b => bg2.has(b)).length;
          const union = new Set([...bg1, ...bg2]).size;
          if (union > 0) {
            const jaccard = intersection / union;
            score = Math.max(score, Math.round(jaccard * 70));
          }
        }
      }

      if (score >= 60 && (!best || score > best.score)) {
        best = { product: p, score };
      }
    }

    if (!best) return null;
    return {
      id:         best.product.id,
      name:       best.product.name,
      nameAr:     best.product.nameAr ?? undefined,
      sku:        best.product.sku ?? undefined,
      matchScore: best.score,
    };
  }
}
