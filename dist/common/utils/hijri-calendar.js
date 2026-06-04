"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HijriCalendar = void 0;
const EVENT_MULTIPLIERS = {
    hajj: {
        antibiotic: 2.5,
        antibiotics: 2.5,
        respiratory: 2.0,
        antidiarrheal: 2.5,
        diarrhea: 2.5,
        gi: 2.0,
        gastrointestinal: 2.0,
        analgesic: 2.0,
        pain: 2.0,
        antimalarial: 1.8,
        electrolyte: 2.2,
        hydration: 2.2,
        ors: 2.5,
        iv: 2.0,
        wound: 1.5,
        antifungal: 1.4,
    },
    pre_hajj: {
        antibiotic: 1.5,
        antibiotics: 1.5,
        antidiarrheal: 1.4,
        analgesic: 1.3,
        electrolyte: 1.5,
        hydration: 1.5,
    },
    ramadan: {
        antacid: 1.8,
        digestive: 1.8,
        gastrointestinal: 1.5,
        gi: 1.5,
        analgesic: 1.6,
        headache: 1.6,
        migraine: 1.5,
        vitamin: 1.5,
        supplement: 1.5,
        antibiotic: 0.8,
        antibiotics: 0.8,
    },
    eid_disruption: {
        _default: 0.65,
    },
    school_return: {
        pediatric: 2.0,
        antibiotic: 1.8,
        antibiotics: 1.8,
        antipyretic: 1.8,
        antihistamine: 1.4,
        cough: 1.5,
        respiratory: 1.4,
        cold: 1.4,
        flu: 1.3,
    },
};
class HijriCalendar {
    static toHijri(date) {
        const Y = date.getFullYear();
        const M = date.getMonth() + 1;
        const D = date.getDate();
        let y = Y, m = M;
        if (m <= 2) {
            y--;
            m += 12;
        }
        const A = Math.floor(y / 100);
        const B = 2 - A + Math.floor(A / 4);
        const jd = Math.floor(365.25 * (y + 4716)) +
            Math.floor(30.6001 * (m + 1)) +
            D + B - 1524;
        const z = jd - 1948438.5;
        const completeCycles = Math.floor((z - 1) / 10631);
        const remaining = z - 10631 * completeCycles - 1;
        const yearInCycle = Math.min(30, Math.floor((remaining - 0.5) / 354.367) + 1);
        const hYear = 30 * completeCycles + yearInCycle;
        const yearStartDay = Math.floor((yearInCycle - 1) * 354.367);
        const dayOfYear = Math.floor(remaining - yearStartDay);
        const hMonth = Math.min(12, Math.floor((dayOfYear - 1) / 29.5) + 1);
        const monthStartDay = Math.floor((hMonth - 1) * 29.5);
        const hDay = dayOfYear - monthStartDay;
        return {
            year: Math.max(1, hYear),
            month: Math.max(1, Math.min(12, hMonth)),
            day: Math.max(1, Math.min(30, hDay)),
        };
    }
    static getActiveEvent(date) {
        const h = this.toHijri(date);
        const gMonth = date.getMonth() + 1;
        const gDay = date.getDate();
        if (h.month === 12 && h.day <= 15) {
            return { event: 'hajj', arabicName: 'موسم الحج', categories: ['antibiotic', 'antidiarrheal', 'analgesic', 'electrolyte'] };
        }
        if (h.month === 11 && h.day >= 15) {
            return { event: 'pre_hajj', arabicName: 'قبيل الحج', categories: ['antibiotic', 'antidiarrheal', 'analgesic'] };
        }
        if (h.month === 9) {
            return { event: 'ramadan', arabicName: 'شهر رمضان', categories: ['antacid', 'digestive', 'analgesic', 'vitamin'] };
        }
        if (h.month === 10 && h.day <= 4) {
            return { event: 'eid_disruption', arabicName: 'عيد الفطر', categories: ['all'] };
        }
        if (gMonth === 9 && gDay <= 21) {
            return { event: 'school_return', arabicName: 'العودة للمدارس', categories: ['pediatric', 'antibiotic', 'antipyretic'] };
        }
        return null;
    }
    static getCategoryMultiplier(date, category) {
        const event = this.getActiveEvent(date);
        if (!event)
            return { multiplier: 1.0, eventName: null, source: 'none' };
        const norm = category.toLowerCase().trim();
        const multipliers = EVENT_MULTIPLIERS[event.event] ?? {};
        if (multipliers['_default'] !== undefined) {
            return {
                multiplier: multipliers['_default'],
                eventName: event.arabicName,
                source: event.event,
            };
        }
        for (const [key, mult] of Object.entries(multipliers)) {
            if (norm.includes(key) || key.includes(norm)) {
                return {
                    multiplier: mult,
                    eventName: event.arabicName,
                    source: event.event,
                };
            }
        }
        return { multiplier: 1.0, eventName: event.arabicName, source: event.event };
    }
    static isHajjSeason(date = new Date()) {
        const h = this.toHijri(date);
        return h.month === 12 && h.day <= 15;
    }
    static isRamadan(date = new Date()) {
        return this.toHijri(date).month === 9;
    }
}
exports.HijriCalendar = HijriCalendar;
//# sourceMappingURL=hijri-calendar.js.map