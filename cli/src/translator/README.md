# translator/ — Business Annotations Producer (M1.4 stub)

> 当前状态:**M1.4 待补**。本目录沉淀了 Provider 抽象 + Claude / Ollama 两个 stub,M1.5 web 前端可以面对 `LLMProvider` 这个稳定 interface 编程,不阻塞前后端联调。
>
> 红线提醒(SPEC §M1 功能 4 / overview red line #2):
> - **空 evidence 拒绝翻译**:产出 `confidence=low + placeholder`,绝不臆造。
> - **Provider 抽象层至少支持 Claude + Ollama**,默认 Claude。
> - **置信度三档**:high / medium / low。

---

## 文件结构

```
translator/
├── provider.ts            # LLMProvider 接口 + ProviderRegistry + TranslateRequest
├── providers/
│   ├── claude.ts          # ClaudeProvider — @anthropic-ai/sdk(M1.4 实现)
│   └── ollama.ts          # OllamaProvider — POST /api/chat 到 ollama server(M1.4 实现)
└── index.ts               # 桶式导出
```

## 抽象层的契约

```ts
interface TranslateRequest {
  flow: FlowGraph;
  evidenceByNode: Record<string, string[]>;     // 每个 nodeId 的 evidence,空 → 拒绝
  evidenceByEdge: Record<string, string[]>;
  contextDocs?: string[];                       // 可选,通常是 backend README §"业务意图清单"
}

interface LLMProvider {
  readonly id: string;
  translate(req: TranslateRequest): Promise<BusinessAnnotations>;
}
```

`TranslateRequest` 的关键设计:**evidence 是入参,不是 prompt 产物**。dataflow-tracer 已经把每个节点/边对应的代码事实抽出来交给 translator;translator 只是"翻译事实",不是"自己生成事实"。这是 evidence 不臆造的工程保证。

## 当前 stub 行为

两个 Provider 类已就位但 `translate()` 方法主动抛 `Error("... not implemented yet — landing in M1.4. ...")`。

下游(orchestrator / CLI / web)在 M1.4 之前不应该调 `provider.translate()` —— 应该用 ground-truth `business-annotations-*.expected.json` 作为占位数据。

## 待 M1.4 实现的真实工作

1. **Claude**:
   - `npm install @anthropic-ai/sdk`
   - prompt 设计:few-shot 的 `<flow>` + `<evidence>` + `<context>` 输入,要求模型按 `BusinessAnnotations` schema 0.1.0 输出 JSON
   - 失败重试 / 限速 / 超时
   - API key 仅从 `ANTHROPIC_API_KEY` env 读取,不出现在前端 bundle
2. **Ollama**:
   - 默认 endpoint `http://localhost:11434`,model `llama3` / `qwen2.5-coder` 等(用户可配)
   - JSON 模式输出 + schema 校验
3. **单测**:
   - mock fetch / SDK,assert 同样的 FlowGraph + evidence 输入,Claude 与 Ollama 都能产出合 schema 的 BusinessAnnotations
   - 故意构造一个 evidence=[] 的节点,assert 输出中该节点 `confidence=low` 且 businessLabel 是 placeholder(red line #2 回归)
4. **CLI 集成**:在 `cli/src/index.ts` 加 `translate <entry> --provider claude|ollama --flow <flow.json> --output <ann.json>` 子命令
