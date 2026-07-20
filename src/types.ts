export type ProviderName = "openai" | "codex";
export type RunStatus =
  | "queued"
  | "running"
  | "awaiting_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

export type RiskLevel = "low" | "medium" | "high" | "blocked";

export interface RunEvent {
  id: number;
  runId: string;
  at: string;
  type:
    | "run.created"
    | "run.started"
    | "model.request"
    | "model.response"
    | "tool.proposed"
    | "approval.required"
    | "approval.accepted"
    | "approval.rejected"
    | "tool.started"
    | "tool.output"
    | "tool.completed"
    | "tool.failed"
    | "run.completed"
    | "run.failed";
  message: string;
  data?: Record<string, unknown>;
}

export interface ToolCall {
  callId: string;
  name: ToolName;
  arguments: Record<string, unknown>;
}

export type ToolName =
  | "win_system_inspect"
  | "win_shell"
  | "win_filesystem"
  | "win_process";

export interface PolicyAssessment {
  decision: "allow" | "confirm" | "block";
  risk: RiskLevel;
  reasons: string[];
  targets: string[];
  protectedTargets: string[];
  fingerprint: string;
  confirmationPhrase?: string;
}

export interface ApprovalRequest {
  id: string;
  runId: string;
  call: ToolCall;
  assessment: PolicyAssessment;
  createdAt: string;
}

export interface ToolResult {
  ok: boolean;
  tool: ToolName;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  truncated?: boolean;
  durationMs?: number;
  error?: string;
  data?: unknown;
  assessment: PolicyAssessment;
}

export interface RunRecord {
  id: string;
  task: string;
  provider: ProviderName;
  cwd: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  answer?: string;
  error?: string;
  events: RunEvent[];
  pendingApproval?: ApprovalRequest;
}

export interface AgentToolDefinition {
  type: "function";
  name: ToolName;
  description: string;
  parameters: Record<string, unknown>;
  strict: true;
}
