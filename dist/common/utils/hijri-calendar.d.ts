export interface HijriDate {
    year: number;
    month: number;
    day: number;
}
export interface DemandEvent {
    event: string;
    arabicName: string;
    categories: string[];
}
export interface DemandSignal {
    multiplier: number;
    eventName: string | null;
    source: 'hajj' | 'ramadan' | 'school_return' | 'pre_hajj' | 'eid_disruption' | 'none';
}
export declare class HijriCalendar {
    static toHijri(date: Date): HijriDate;
    static getActiveEvent(date: Date): DemandEvent | null;
    static getCategoryMultiplier(date: Date, category: string): DemandSignal;
    static isHajjSeason(date?: Date): boolean;
    static isRamadan(date?: Date): boolean;
}
