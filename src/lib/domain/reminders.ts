const MINUTE_MS = 60_000;

export type ReminderScheduleInput = {
  eventStart: Date;
  routeDurationMinutes: number;
  requiredBufferMinutes: number;
  headsUpMinutes?: number;
};

export type ReminderSchedule = {
  leaveBy: Date;
  headsUpAt: Date;
};

function requireNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}

export function calculateReminderSchedule(
  input: ReminderScheduleInput,
): ReminderSchedule {
  if (Number.isNaN(input.eventStart.getTime())) {
    throw new RangeError("eventStart must be a valid date");
  }

  requireNonNegativeInteger(
    "routeDurationMinutes",
    input.routeDurationMinutes,
  );
  requireNonNegativeInteger(
    "requiredBufferMinutes",
    input.requiredBufferMinutes,
  );

  const headsUpMinutes = input.headsUpMinutes ?? 30;
  requireNonNegativeInteger("headsUpMinutes", headsUpMinutes);

  const leaveBy = new Date(
    input.eventStart.getTime() -
      (input.routeDurationMinutes + input.requiredBufferMinutes) * MINUTE_MS,
  );
  const headsUpAt = new Date(
    leaveBy.getTime() - headsUpMinutes * MINUTE_MS,
  );

  return { leaveBy, headsUpAt };
}
