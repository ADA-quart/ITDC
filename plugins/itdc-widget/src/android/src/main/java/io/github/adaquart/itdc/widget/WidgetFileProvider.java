package io.github.adaquart.itdc.widget;

/**
 * 小组件背景图的 FileProvider。
 *
 * App 里已经有一个 {@code androidx.core.content.FileProvider}，清单合并按类名走，
 * 同名会被合并成同一个 provider；这里用一个空子类占位，拿到独立的 authority
 * 与独立的白名单（只放 files/widget/）。
 */
public class WidgetFileProvider extends androidx.core.content.FileProvider {
}
