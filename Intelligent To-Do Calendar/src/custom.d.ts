declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database;
  }

  interface Database {
    exec(sql: string, params?: any[]): any[];
    prepare(sql: string): Statement;
    getRowsModified(): number;
    export(): Uint8Array;
    close(): void;
    run(sql: string, params?: any[]): Database;
  }

  interface Statement {
    bind(params?: any[]): boolean;
    step(): boolean;
    getAsObject(): any;
    free(): boolean;
    get(params?: any[]): any[];
  }

  export default function initSqlJs(options?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
}

declare module 'ical.js' {
  interface ICAL {
    parse(ics: string): any[];
    Component: new (jcal: any) => Component;
    Event: new (component: Component) => Event;
  }

  interface Component {
    getAllSubcomponents(name?: string): Component[];
    getFirstProperty(name: string): Property | null;
  }

  interface Property {
    getFirstValue(): any;
    removeParameter(name: string): void;
  }

  interface Event {
    summary: string;
    description: string;
    location: string;
    uid: string;
    startDate: Time;
    endDate: Time;
    isRecurring(): boolean;
  }

  interface Time {
    toJSDate(): Date;
  }

  const ical: ICAL;
  export default ical;
}
