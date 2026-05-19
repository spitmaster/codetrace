# M1 端到端准确率报告

> 自动生成 by `npm run e2e:m1`。Provider = **claude-code**。
> Provider 切换:`npm run e2e:m1 -- --provider <mock|claude|ollama|claude-code>`。claude 需要 ANTHROPIC_API_KEY;claude-code 复用本机 `claude` CLI 的 OAuth/订阅。
> 生成时间: 2026-05-19T03:51:59.135Z

## 1. SymbolGraph 召回率(SPEC §7 ≥ 80%)

| 指标 | 值 |
|---|---|
| 期望符号数 | 19 |
| 匹配符号数 | 19 |
| 召回率 | **100.0%** PASS |

## 2. IOEntryRegistry 准确率(SPEC §7 = 100%)

| 指标 | 值 |
|---|---|
| 期望 entry 数 | 5 |
| 匹配 entry 数 | 5 |
| 准确率 | **100.0%** PASS |
| 缺失 | 0 |
| 候选额外 entry | 0 |
| 字段不匹配数 | 0 |

## 3. FlowGraph 主路径覆盖(SPEC §7 ≥ 80%)

| Entry | nodes (cand/gt) | edges (cand/gt) | nodeCoverage | edgeCoverage | table-ops | 结果 |
|---|---|---|---|---|---|---|
| io:http:POST:/api/orders | 15/15 | 15/16 | 100.0% | 93.8% | 100.0% | PASS |
| io:http:GET:/api/orders | 8/8 | 8/9 | 100.0% | 88.9% | 100.0% | PASS |
| io:http:GET:/api/orders/:id | 11/9 | 10/9 | 100.0% | 88.9% | 100.0% | PASS |
| io:http:DELETE:/api/orders/:id | 13/12 | 13/13 | 100.0% | 92.3% | 100.0% | PASS |

平均 nodeCoverage = **100.0%**;平均 edgeCoverage = **91.0%**;主路径整体 PASS

> **产出目录约定**(2026-05-19 起):
>
> - `mock` provider 的 JSON 写到 `reports/m1-out/`(CI / web 默认路径)。
> - 其他 provider 写到 `reports/m1-out-<provider>/`,如 `reports/m1-out-claude-code/`。
> - 想强制覆盖路径用 `--out-dir <path>`。
> - 这样真实 LLM 的输出不会被后续一次 mock 跑悄悄覆盖。

## 4. BusinessAnnotations 准确率(SPEC §7 人工评估 ≥ 80%;provider = `claude-code`)

| Entry | nodeCov | labelMatch | edgeLabelMatch | evidenceNonEmpty | high+medium 比例 |
|---|---|---|---|---|---|
| io:http:POST:/api/orders | 100.0% | 21.4% | 0.0% | 100.0% | 90.0% |
| io:http:GET:/api/orders | 100.0% | 42.9% | 100.0% | 100.0% | 81.3% |
| io:http:GET:/api/orders/:id | 100.0% | 37.5% | 25.0% | 100.0% | 85.7% |
| io:http:DELETE:/api/orders/:id | 100.0% | 27.3% | 80.0% | 100.0% | 88.5% |

平均 nodeCoverage = **100.0%**
平均 labelMatchRate = **32.3%**
平均 edgeLabelMatchRate = **51.2%**
平均 evidenceNonEmpty = **100.0%** (红线 #2 要求 100%)
平均 high+medium 比例 = **86.4%**
80% 双门槛(labelMatch ≥ 80% AND high+medium ≥ 80%): MISS

> Provider = `claude-code`,这是真实 LLM 输出。SPEC §7 的 80% 双门槛在此 provider 下生效。

### labelMismatches — io:http:POST:/api/orders (前 5)
- `n4`: gt=`创建订单(事务编排)` ↔ cand=`创建订单服务`
- `n5`: gt=`校验买家存在` ↔ cand=`查询用户`
- `n6`: gt=`校验库存并预占` ↔ cand=`用户表`
- `n7`: gt=`读取商品(库存 + 价格)` ↔ cand=`新增订单记录`
- `n8`: gt=`扣减库存` ↔ cand=`订单表`

### labelMismatches — io:http:GET:/api/orders (前 5)
- `n4`: gt=`查询我的订单列表(分页)` ↔ cand=`订单列表服务`
- `n5`: gt=`按用户 ID 倒序取本页订单` ↔ cand=`查询订单列表`
- `n6`: gt=`统计本用户订单总数` ↔ cand=`订单表`
- `n7`: gt=`订单表` ↔ cand=`统计订单总数`

### labelMismatches — io:http:GET:/api/orders/:id (前 5)
- `n4`: gt=`查询订单详情(校验归属 + 关联展开)` ↔ cand=`订单详情服务`
- `n5`: gt=`按归属取订单与关联` ↔ cand=`查订单主记录`
- `n7`: gt=`订单行表(关联展开)` ↔ cand=`查订单行`
- `n8`: gt=`商品摘要(只取 id/name/price)` ↔ cand=`订单行表`
- `n9`: gt=`返回订单详情` ↔ cand=`查商品信息`

### labelMismatches — io:http:DELETE:/api/orders/:id (前 5)
- `n4`: gt=`取消订单(事务编排)` ↔ cand=`取消订单服务`
- `n6`: gt=`回滚库存` ↔ cand=`订单表`
- `n7`: gt=`增加库存(回滚)` ↔ cand=`查询订单行`
- `n8`: gt=`翻订单状态为 cancelled` ↔ cand=`订单行表`
- `n9`: gt=`订单表` ↔ cand=`改写订单状态`

## 5. M1 退出条件汇总

| 验收项 | 阈值 | 实际 | 结果 |
|---|---|---|---|
| SymbolGraph 召回 | ≥ 80% | 100.0% | PASS |
| IOEntryRegistry 准确 | = 100% | 100.0% | PASS |
| FlowGraph 主路径覆盖 | ≥ 80% | 100.0% | PASS |
| BusinessAnnotations(provider = claude-code) | ≥ 80% | 32.3% | MISS  |

**整体(SymbolGraph / IO / FlowGraph 三项 hard requirement)**: PASS
