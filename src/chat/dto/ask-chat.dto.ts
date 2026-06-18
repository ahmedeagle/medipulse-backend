import { IsIn, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class AskChatDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'question must contain at least one non-whitespace character' })
  @MinLength(2)
  @MaxLength(500)
  question: string;
}

export class ChatExecuteDto {
  @IsString()
  @IsIn(['suggest_p2p_listings', 'suggest_dead_stock_review'])
  actionType: 'suggest_p2p_listings' | 'suggest_dead_stock_review';
}

// ── Response card types ───────────────────────────────────────────────────────

export type ResponseCardColor = 'emerald' | 'amber' | 'red' | 'blue';

export type ResponseCard =
  | {
      type: 'kpi_row';
      items: Array<{ label: string; value: string; color: ResponseCardColor }>;
    }
  | {
      type: 'table';
      title?: string;
      columns: Array<{ key: string; header: string; align?: 'start' | 'end' }>;
      rows: Record<string, string | number | null>[];
    }
  | {
      type: 'action_confirmed';
      message: string;
      route?: string;
    };

// ── Chat action buttons ───────────────────────────────────────────────────────

export interface ChatActionButton {
  label: string;
  route?: string;       // navigate to a page (mutually exclusive with actionType)
  actionType?: string;  // execute an inline action (mutually exclusive with route)
}

// ── Response types ────────────────────────────────────────────────────────────

export interface ChatAnswerItem {
  label: string;
  value: string | number;
  unit?: string;
  severity?: 'ok' | 'warn' | 'danger';
}

export interface ChatAnswer {
  type: 'answer' | 'not_configured' | 'error';
  text?: string;
  cards?: ResponseCard[];
  items?: ChatAnswerItem[];
  question?: string;
  message?: string;
  actions?: ChatActionButton[];
}

export interface ChatExecuteResult {
  count: number;
  approvalIds: string[];
  message: string;
  route: string;
}
