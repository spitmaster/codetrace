# M1 端到端准确率报告

> 自动生成 by `npm run e2e:m1`。Provider = mock(确定性、离线、无 LLM)。
> Provider 切换:`npm run e2e:m1 -- --provider claude` 需要 ANTHROPIC_API_KEY。
> 生成时间: 2026-05-19T03:03:24.549Z

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

## 4. BusinessAnnotations 准确率(SPEC §7 人工评估 ≥ 80%;此处为 mock 自动近似)

| Entry | nodeCov | labelMatch | edgeLabelMatch | evidenceNonEmpty | high+medium 比例 |
|---|---|---|---|---|---|
| io:http:POST:/api/orders | 100.0% | 35.7% | 0.0% | 100.0% | 90.0% |
| io:http:GET:/api/orders | 100.0% | 57.1% | 100.0% | 100.0% | 81.3% |
| io:http:GET:/api/orders/:id | 100.0% | 37.5% | 25.0% | 100.0% | 85.7% |
| io:http:DELETE:/api/orders/:id | 100.0% | 45.5% | 20.0% | 100.0% | 88.5% |

平均 nodeCoverage = **100.0%**
平均 labelMatchRate = **44.0%**
平均 edgeLabelMatchRate = **36.3%**
平均 evidenceNonEmpty = **100.0%** (红线 #2 要求 100%)
平均 high+medium 比例 = **86.4%**
80% 双门槛(labelMatch ≥ 80% AND high+medium ≥ 80%): MISS

> Mock provider 是规则引擎,不是 LLM。labelMatch 命中率反映规则覆盖,非"业务理解"准确率;
> 真正的 ≥ 80% 业务翻译质量需 ClaudeProvider + 人工评估,落地于 M1.4 真实 LLM 跑通后。

### labelMismatches — io:http:POST:/api/orders (前 5)
- `n4`: gt=`创建订单(事务编排)` ↔ cand=`createOrder(函数)`
- `n5`: gt=`校验买家存在` ↔ cand=`读取用户表`
- `n6`: gt=`校验库存并预占` ↔ cand=`用户表`
- `n7`: gt=`读取商品(库存 + 价格)` ↔ cand=`写入订单表`
- `n8`: gt=`扣减库存` ↔ cand=`订单表`

### labelMismatches — io:http:GET:/api/orders (前 5)
- `n4`: gt=`查询我的订单列表(分页)` ↔ cand=`listOrders(函数)`
- `n5`: gt=`按用户 ID 倒序取本页订单` ↔ cand=`读取订单表`
- `n6`: gt=`统计本用户订单总数` ↔ cand=`订单表`

### labelMismatches — io:http:GET:/api/orders/:id (前 5)
- `n4`: gt=`查询订单详情(校验归属 + 关联展开)` ↔ cand=`getOrderDetail(函数)`
- `n5`: gt=`按归属取订单与关联` ↔ cand=`读取订单表`
- `n7`: gt=`订单行表(关联展开)` ↔ cand=`读取订单行表`
- `n8`: gt=`商品摘要(只取 id/name/price)` ↔ cand=`订单行表`
- `n9`: gt=`返回订单详情` ↔ cand=`读取商品表`

### labelMismatches — io:http:DELETE:/api/orders/:id (前 5)
- `n4`: gt=`取消订单(事务编排)` ↔ cand=`cancelOrder(函数)`
- `n6`: gt=`回滚库存` ↔ cand=`订单表`
- `n7`: gt=`增加库存(回滚)` ↔ cand=`读取订单行表`
- `n8`: gt=`翻订单状态为 cancelled` ↔ cand=`订单行表`
- `n10`: gt=`订单行表(只读)` ↔ cand=`restoreStock(函数)`

## 5. M1 退出条件汇总

| 验收项 | 阈值 | 实际 | 结果 |
|---|---|---|---|
| SymbolGraph 召回 | ≥ 80% | 100.0% | PASS |
| IOEntryRegistry 准确 | = 100% | 100.0% | PASS |
| FlowGraph 主路径覆盖 | ≥ 80% | 100.0% | PASS |
| BusinessAnnotations(mock 自动近似) | ≥ 80% | 44.0% | MISS (不阻塞 M1 退出 — 需真实 LLM) |

**整体(SymbolGraph / IO / FlowGraph 三项 hard requirement)**: PASS
