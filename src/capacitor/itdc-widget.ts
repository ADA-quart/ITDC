import { registerPlugin } from "@capacitor/core";

export interface ItdcWidgetPluginInterface {
  setServerUrl(params: { url: string }): Promise<void>;
}

export const ITDCWidgetPlugin = registerPlugin<ItdcWidgetPluginInterface>("itdc-widget");
