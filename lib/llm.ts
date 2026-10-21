/**
 * 大模型调用唯一入口。
 * 所有大模型请求都必须经过本文件，禁止在业务代码里直接实例化 SDK。
 * TODO(PRD 步骤 2)：疑点拆解的结构化输出。
 * TODO(PRD 步骤 6)：五档判决的结构化输出。
 */
export type LlmMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export async function callLlm(messages: LlmMessage[]): Promise<string> {
  throw new Error(`TODO(PRD 步骤 2/6)：lib/llm.ts 尚未实现（${messages.length} 条消息）`);
}
