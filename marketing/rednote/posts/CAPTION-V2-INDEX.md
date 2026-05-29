# Caption v2 Index (Chalette 框架改造)

10 个 quote-card + 2 个 carousel 加了 v2 文案 / 标签. 每个 `title-v2.txt` / `body-v2.txt` / `hashtags-v2.txt` 与原 v1 并存. 发布时择优.

## 改造对照表

| Folder | v1 title | v2 title | 改造重点 |
| :-- | :-- | :-- | :-- |
| `qday5` | 最安静的那个，往往最强 | 内向求职者必看｜不擅长自嗨，怎么赢？ | 加痛点+3 个方法 |
| `qday12` | 你的出身不决定你的未来 | 不是名校、起点低｜照样拿 offer 的 5 个动作 | 加方法感+从 0 到 1 |
| `qday19` | 被拒，有时是因为你太好了 | 被拒不是你的错｜HR 圈内的 3 个潜规则 | 加真实故事+底层逻辑 |
| `qday25` | 钻石不会偶然遇见珠宝匠 | 对的 offer 不会自己找上门｜求职的底层逻辑 | 改成底层逻辑型+3 个方法 |
| `qday32` | 被低薪绑架≠你不值钱 | 被低薪绑架 3 年｜转岗 +RM2,500 复盘 | 改成真实故事+数据 |
| `qday39` | 好公司是点亮人才 | 面试就能感觉到的 5 个信号｜值不值得去 | 改成实用判断指南 |
| `qday46` | 每个人都是钻石 | 你不是不够好｜只是没遇到对的人（陪伴篇） | 加陪伴语气 |
| `qday101` | 与其投100份，不如等对的3个 | 海投 127 份没回｜AI 筛 3 个就拿 offer（真实复盘） | 加真实故事+数据 |
| `qday108` | 最好的招聘不是大海捞针 | 最好的招聘不是大海捞针｜给求职者的话 | 加副标题+3 个方法 |
| `qday114` | 你不是不行，只是没被看见 | 致还没拿到 offer 的你｜这话 AI 想说很久了 | 加共鸣+陪伴 |
| `day45` | （文案 v1 OK） | (v1 + 新标签) | 标签 v2 加 套组 E |
| `day60` | （文案 v1 OK） | (v1 + 新标签) | 标签 v2 加 套组 E |

## Chalette 套组 E（每篇 v2 都注入了 3-5 个）

```
#干货 #成长 #求职干货 #实用指南 #真实故事 #手把手 #底层逻辑 #马来西亚 #DNJ
```

新增延伸标签库：
- 共鸣类: #陪伴 #情绪价值 #求职焦虑
- 干货类: #实用指南 #手把手 #从0到1
- 真相类: #底层逻辑 #真实故事 #HR真相
- 收入类: #收入突破 #涨薪

## 发布时怎么选

**v2 适合的场景：**
- 想要更强转化（带"3 个方法"/"5 个动作"/"真实故事"）
- 想要更准的搜索匹配（hot keywords 多）
- 想突破停滞期（前几篇互动 < 50 CES 时换 v2）

**v1 保留的场景：**
- 纯粹诗意 / 情绪价值场景
- 品牌叙事日（如周末 / 月底复盘）
- A/B 测试时（同主题 v1 vs v2 各发一次比数据）

## 改 ADB 发布脚本（提示）

发布时把 `title-v2.txt` / `body-v2.txt` / `hashtags-v2.txt` 重命名为 `title.txt` / `body.txt` / `hashtags.txt` 即可走原 recipe — 或者改 `log_post.py` 让它接受 `--v2` flag.

简单方案：
```bash
cd posts/qday19
mv title.txt title-v1.txt
mv body.txt body-v1.txt
mv hashtags.txt hashtags-v1.txt
mv title-v2.txt title.txt
mv body-v2.txt body.txt
mv hashtags-v2.txt hashtags.txt
```

发完日志的 cover_hook 字段会自动反映新标题（在 info.json 里更新 cover_hook 字段一行即可）.
