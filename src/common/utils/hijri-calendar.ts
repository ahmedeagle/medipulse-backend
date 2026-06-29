/**
 * Hijri Calendar Utility for Saudi pharmaceutical demand modeling.
 *
 * Replaces the hardcoded SEASONAL_RULES table in the rules engine.
 * The old approach (winter = Nov-Feb → +25% respiratory) was built on
 * Western European calendar assumptions that do not apply to Saudi Arabia.
 *
 * Real Saudi pharma demand drivers:
 *
 *   HAJJ (Dhu al-Hijja 1–15):
 *     2–3M pilgrims + population surge in Mecca/Medina
 *     → Antibiotics +250%, Antidiarrheals +250%, Analgesics +200%
 *     → Antimalarials +180%, IV fluids +220%, Wound care +150%
 *     CRITICAL: Hajj shifts ~11 days earlier each Gregorian year.
 *     Cannot be modeled with month-of-year rules.
 *
 *   RAMADAN (full month 9):
 *     Fasting changes medication timing, dietary patterns
 *     → Antacids +80%, Headache meds +60%, Digestive +70%
 *     → Antibiotics -20% (people avoid clinics during Ramadan)
 *
 *   SCHOOL RETURN (Gregorian September 1-21, fixed annually):
 *     Children spread respiratory infections at school reopening
 *     → Pediatric antibiotics +120%, Antipyretics +80%
 *
 * Algorithm: Astronomical Julian Day Number → Hijri conversion
 * Accuracy: ±1 day (sufficient for monthly demand modeling)
 *
 * For production: consider integrating with the Umm al-Qura calendar API
 * (published by Saudi Arabia's Ministry of Islamic Affairs) for exact dates
 * based on moon sighting rather than astronomical calculation.
 */

export interface HijriDate {
  year:  number;
  month: number; // 1 = Muharram … 12 = Dhu al-Hijja
  day:   number;
}

export interface DemandEvent {
  event:      string;
  arabicName: string;
  categories: string[];
}

export interface DemandSignal {
  multiplier:  number;
  eventName:   string | null;
  source:      'hajj' | 'ramadan' | 'school_return' | 'pre_hajj' | 'eid_disruption' | 'none';
}

// ── Category demand multipliers per event ────────────────────────────────────

const EVENT_MULTIPLIERS: Record<string, Record<string, number>> = {
  hajj: {
    antibiotic:       2.5,
    antibiotics:      2.5,
    respiratory:      2.0,
    antidiarrheal:    2.5,
    diarrhea:         2.5,
    gi:               2.0,
    gastrointestinal: 2.0,
    analgesic:        2.0,
    pain:             2.0,
    antimalarial:     1.8,
    electrolyte:      2.2,
    hydration:        2.2,
    ors:              2.5,
    iv:               2.0,
    wound:            1.5,
    antifungal:       1.4,
  },
  pre_hajj: {
    antibiotic:    1.5,
    antibiotics:   1.5,
    antidiarrheal: 1.4,
    analgesic:     1.3,
    electrolyte:   1.5,
    hydration:     1.5,
  },
  ramadan: {
    antacid:          1.8,
    digestive:        1.8,
    gastrointestinal: 1.5,
    gi:               1.5,
    analgesic:        1.6,
    headache:         1.6,
    migraine:         1.5,
    vitamin:          1.5,
    supplement:       1.5,
    antibiotic:       0.8,  // fewer clinic visits during Ramadan
    antibiotics:      0.8,
  },
  eid_disruption: {
    // Supply chain disruption — pharmacies closed, reduced demand
    _default: 0.65,
  },
  school_return: {
    pediatric:    2.0,
    antibiotic:   1.8,
    antibiotics:  1.8,
    antipyretic:  1.8,
    antihistamine:1.4,
    cough:        1.5,
    respiratory:  1.4,
    cold:         1.4,
    flu:          1.3,
  },
};

export class HijriCalendar {
  /**
   * Convert a Gregorian date to Hijri (Islamic) calendar date.
   * Uses the Julian Day Number algorithm.
   */
  static toHijri(date: Date): HijriDate {
    const Y = date.getFullYear();
    const M = date.getMonth() + 1;
    const D = date.getDate();

    // Step 1: Gregorian → Julian Day Number
    let y = Y, m = M;
    if (m <= 2) { y--; m += 12; }
    const A = Math.floor(y / 100);
    const B = 2 - A + Math.floor(A / 4);
    const jd = Math.floor(365.25 * (y + 4716)) +
               Math.floor(30.6001 * (m + 1)) +
               D + B - 1524;

    // Step 2: Julian Day → Hijri
    // Reference: epoch = 1 Muharram 1 AH = Julian Day 1948438.5
    const z = jd - 1948438.5;

    // Number of complete 30-year cycles (each = 10631 days)
    const completeCycles = Math.floor((z - 1) / 10631);
    const remaining       = z - 10631 * completeCycles - 1;

    // Approximate year within cycle
    const yearInCycle = Math.min(30, Math.floor((remaining - 0.5) / 354.367) + 1);
    const hYear       = 30 * completeCycles + yearInCycle;

    // Days elapsed at start of this year
    const yearStartDay = Math.floor((yearInCycle - 1) * 354.367);
    const dayOfYear    = Math.floor(remaining - yearStartDay);

    // Month within year (lunar months alternate 29/30 days)
    const hMonth = Math.min(12, Math.floor((dayOfYear - 1) / 29.5) + 1);
    const monthStartDay = Math.floor((hMonth - 1) * 29.5);
    const hDay   = dayOfYear - monthStartDay;

    return {
      year:  Math.max(1, hYear),
      month: Math.max(1, Math.min(12, hMonth)),
      day:   Math.max(1, Math.min(30, hDay)),
    };
  }

  /**
   * Detect the active demand event for a given date.
   */
  static getActiveEvent(date: Date): DemandEvent | null {
    const h = this.toHijri(date);
    const gMonth = date.getMonth() + 1;
    const gDay   = date.getDate();

    // Hajj: Dhu al-Hijja (month 12), days 1-15
    if (h.month === 12 && h.day <= 15) {
      return { event: 'hajj', arabicName: 'موسم الحج', categories: ['antibiotic', 'antidiarrheal', 'analgesic', 'electrolyte'] };
    }

    // Pre-Hajj: Dhu al-Qi'da (month 11), last 2 weeks
    if (h.month === 11 && h.day >= 15) {
      return { event: 'pre_hajj', arabicName: 'قبيل الحج', categories: ['antibiotic', 'antidiarrheal', 'analgesic'] };
    }

    // Ramadan: month 9, entire month
    if (h.month === 9) {
      return { event: 'ramadan', arabicName: 'شهر رمضان', categories: ['antacid', 'digestive', 'analgesic', 'vitamin'] };
    }

    // Eid al-Fitr disruption: Shawwal (month 10), days 1-4
    if (h.month === 10 && h.day <= 4) {
      return { event: 'eid_disruption', arabicName: 'عيد الفطر', categories: ['all'] };
    }

    // School return: Gregorian September 1-21 (fixed)
    if (gMonth === 9 && gDay <= 21) {
      return { event: 'school_return', arabicName: 'العودة للمدارس', categories: ['pediatric', 'antibiotic', 'antipyretic'] };
    }

    return null;
  }

  /**
   * Get the demand multiplier for a specific product category on a given date.
   *
   * Returns:
   *   multiplier: how much to scale demand (1.5 = +50%, 0.8 = -20%, 1.0 = no change)
   *   eventName:  the triggering event, or null
   *   source:     typed source for audit trail in RecommendationDecisionTrace
   */
  static getCategoryMultiplier(date: Date, category: string): DemandSignal {
    const event = this.getActiveEvent(date);
    if (!event) return { multiplier: 1.0, eventName: null, source: 'none' };

    const norm = category.toLowerCase().trim();
    const multipliers = EVENT_MULTIPLIERS[event.event] ?? {};

    // Check _default wildcard (e.g. Eid disruption affects all categories)
    if (multipliers['_default'] !== undefined) {
      return {
        multiplier: multipliers['_default'],
        eventName:  event.arabicName,
        source:     event.event as DemandSignal['source'],
      };
    }

    // Find matching category keyword
    for (const [key, mult] of Object.entries(multipliers)) {
      if (norm.includes(key) || key.includes(norm)) {
        return {
          multiplier: mult,
          eventName:  event.arabicName,
          source:     event.event as DemandSignal['source'],
        };
      }
    }

    // Event is active but this category is not specifically affected — no change
    return { multiplier: 1.0, eventName: event.arabicName, source: event.event as DemandSignal['source'] };
  }

  /**
   * Return the affected categories for an event with their demand multipliers,
   * sorted by impact (highest first). Used by the seasonality banner UI.
   * Skips the `_default` wildcard and any de-boost (<1.0) entries so the banner
   * only surfaces "stock up" signals.
   */
  static getEventCategoryMultipliers(
    eventKey: string,
    limit = 6,
  ): { category: string; multiplier: number }[] {
    const multipliers = EVENT_MULTIPLIERS[eventKey] ?? {};
    return Object.entries(multipliers)
      .filter(([key, mult]) => key !== '_default' && mult > 1.0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([category, multiplier]) => ({ category, multiplier }));
  }

  /**
   * Scan forward up to `horizonDays` to find the next demand event that is not
   * already active today. Returns the event plus how many days until it starts.
   * Used to show an "upcoming season" banner before the spike hits.
   */
  static getUpcomingEvent(
    date: Date = new Date(),
    horizonDays = 45,
  ): { event: DemandEvent; daysUntil: number } | null {
    const todayEvent = this.getActiveEvent(date)?.event ?? null;
    for (let i = 1; i <= horizonDays; i++) {
      const future = new Date(date.getTime() + i * 86_400_000);
      const ev = this.getActiveEvent(future);
      if (ev && ev.event !== todayEvent) {
        return { event: ev, daysUntil: i };
      }
    }
    return null;
  }

  /**
   * Check if today is within Hajj season — useful for quick branching.
   */
  static isHajjSeason(date: Date = new Date()): boolean {
    const h = this.toHijri(date);
    return h.month === 12 && h.day <= 15;
  }

  /**
   * Check if today is within Ramadan.
   */
  static isRamadan(date: Date = new Date()): boolean {
    return this.toHijri(date).month === 9;
  }
}
