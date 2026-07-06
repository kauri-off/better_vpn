// Expiry and quota inputs shared by the create-user and edit-user forms.
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { List, SegmentedButtons, Switch, TextInput, useTheme } from "react-native-paper";
import { DatePickerModal } from "react-native-paper-dates";

import { fmtTs } from "@/lib/format";
import { QUOTA_UNITS, type QuotaUnit } from "@/lib/quota";

/** Expiry as unix seconds; 0 = never. Picked dates expire at end-of-day local time. */
export function ExpiryField({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <List.Item
        title="Expiry"
        description={value > 0 ? fmtTs(value) : "never"}
        left={(p) => <List.Icon {...p} icon="calendar-clock" />}
        right={() => (
          <Switch value={value > 0} onValueChange={(on) => (on ? setOpen(true) : onChange(0))} />
        )}
        onPress={() => setOpen(true)}
      />
      <DatePickerModal
        locale="en"
        mode="single"
        visible={open}
        date={value > 0 ? new Date(value * 1000) : new Date(Date.now() + 30 * 86400_000)}
        validRange={{ startDate: new Date() }}
        onDismiss={() => setOpen(false)}
        onConfirm={({ date }) => {
          setOpen(false);
          if (!date) return;
          const end = new Date(date);
          end.setHours(23, 59, 59, 0);
          onChange(Math.floor(end.getTime() / 1000));
        }}
      />
    </>
  );
}

/** Quota entry: unlimited toggle + value/unit. */
export function QuotaField({
  value,
  unit,
  unlimited,
  onChange,
}: {
  value: string;
  unit: QuotaUnit;
  unlimited: boolean;
  onChange: (v: { value: string; unit: QuotaUnit; unlimited: boolean }) => void;
}) {
  const theme = useTheme();
  return (
    <View>
      <List.Item
        title="Traffic quota"
        description={unlimited ? "unlimited" : undefined}
        left={(p) => <List.Icon {...p} icon="chart-donut" />}
        right={() => (
          <Switch
            value={!unlimited}
            onValueChange={(on) => onChange({ value, unit, unlimited: !on })}
          />
        )}
      />
      {!unlimited && (
        <View style={styles.quotaRow}>
          <TextInput
            mode="outlined"
            label="Amount"
            value={value}
            onChangeText={(v) => onChange({ value: v, unit, unlimited })}
            keyboardType="numeric"
            style={styles.quotaInput}
          />
          <SegmentedButtons
            value={unit}
            onValueChange={(u) => onChange({ value, unit: u as QuotaUnit, unlimited })}
            buttons={QUOTA_UNITS.map((u) => ({ value: u, label: u }))}
            style={styles.quotaUnits}
            theme={theme}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  quotaRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 },
  quotaInput: { flex: 1 },
  quotaUnits: { flexShrink: 0, width: 180 },
});
