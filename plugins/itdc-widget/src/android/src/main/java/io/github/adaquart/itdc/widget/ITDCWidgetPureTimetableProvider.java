// © 2026 ADA-Quart & TyTs · 日日新（ITDC）· PolyForm Noncommercial 1.0.0 · github.com/ADA-quart/ITDC

package io.github.adaquart.itdc.widget;

/**
 * 「纯课表」小组件条目：只显示今天 / 明天的课程，隐藏待办区。
 *
 * 需求来自用户反馈：有人只想在桌面上看课表，不想看到待办列表。
 * 渲染逻辑完全继承 {@link ITDCWidgetProvider}，差异只有两条：
 *   1. 清单里声明自己的 min 尺寸与名字（res/xml/app_widget_itdc_pure.xml）；
 *   2. 渲染时按 provider 类名隐藏待办区（applyPureTimetableIfNeeded）。
 */
public class ITDCWidgetPureTimetableProvider extends ITDCWidgetProvider {
}
