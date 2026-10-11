// © 2026 ADA-Quart & TyTs · 日日新（ITDC）· PolyForm Noncommercial 1.0.0 · github.com/ADA-quart/ITDC

package io.github.adaquart.itdc.widget;

/**
 * 「小尺寸」小组件条目：默认 2×2 起步（清单里 minWidth/minHeight = 110dp）。
 *
 * 小米等启动器用 minWidth/minHeight 换算「添加小部件」里的默认格数，
 * 一个条目没法做到「手机默认 4×2、平板默认 2×2」两全，于是拆成两个 receiver：
 *   标准（ITDCWidgetProvider）      min 250×180dp —— 手机上加出来就是 4×2；
 *   小尺寸（本类）                  min 110×110dp —— 平板上也能直接加出 2×2（格子大，放得下完整内容）。
 *
 * 渲染、刷新、点按逻辑全部继承，不做任何覆写 —— 差异只在 res/xml 的元数据。
 */
public class ITDCWidgetSmallProvider extends ITDCWidgetProvider {
}
