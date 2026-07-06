import { useMutation, useQuery } from "@connectrpc/connect-query";
import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import {
  ActivityIndicator,
  Banner,
  Button,
  Card,
  Chip,
  Dialog,
  Divider,
  HelperText,
  List,
  Portal,
  SegmentedButtons,
  Snackbar,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";

import { Screen } from "@/components/screen";
import {
  generateCert,
  getCertInfo,
  getConfig,
  restartCore,
  updateConfig,
} from "@/gen/panel-PanelService_connectquery";
import type { HysteriaConfig } from "@/gen/panel_pb";
import { fmtTs } from "@/lib/format";

export default function ServerScreen() {
  const [view, setView] = useState<"config" | "cert">("config");
  return (
    <Screen title="Server">
      <View style={styles.segmentWrap}>
        <SegmentedButtons
          value={view}
          onValueChange={(v) => setView(v as typeof view)}
          buttons={[
            { value: "config", label: "Config", icon: "tune" },
            { value: "cert", label: "Certificate", icon: "certificate" },
          ]}
        />
      </View>
      {view === "config" ? <ConfigView /> : <CertView />}
    </Screen>
  );
}

// ---- Config ----

interface ConfigForm {
  listen: string;
  tlsCert: string;
  tlsKey: string;
  obfsType: "" | "salamander";
  obfsPassword: string;
  bandwidthUp: string;
  bandwidthDown: string;
  masqType: "" | "proxy" | "string";
  masqProxyUrl: string;
  masqString: string;
  resolverType: "" | "dns" | "udp" | "tcp" | "tls" | "https";
  resolverAddr: string;
  resolverTimeout: string;
  resolverSni: string;
  acl: string;
}

function toForm(c: HysteriaConfig): ConfigForm {
  return {
    listen: c.listen,
    tlsCert: c.tls?.cert ?? "",
    tlsKey: c.tls?.key ?? "",
    obfsType: (c.obfs?.type ?? "") as ConfigForm["obfsType"],
    obfsPassword: c.obfs?.password ?? "",
    bandwidthUp: c.bandwidth?.up ?? "",
    bandwidthDown: c.bandwidth?.down ?? "",
    masqType: (c.masquerade?.type ?? "") as ConfigForm["masqType"],
    masqProxyUrl: c.masquerade?.proxyUrl ?? "",
    masqString: c.masquerade?.stringContent ?? "",
    resolverType: (c.resolver?.type ?? "") as ConfigForm["resolverType"],
    resolverAddr: c.resolver?.addr ?? "",
    resolverTimeout: c.resolver?.timeout ?? "",
    resolverSni: c.resolver?.sni ?? "",
    acl: (c.acl?.inline ?? []).join("\n"),
  };
}

function fromForm(f: ConfigForm) {
  return {
    listen: f.listen.trim(),
    tls: { cert: f.tlsCert.trim(), key: f.tlsKey.trim() },
    obfs: { type: f.obfsType, password: f.obfsPassword },
    bandwidth: { up: f.bandwidthUp.trim(), down: f.bandwidthDown.trim() },
    masquerade: {
      type: f.masqType,
      proxyUrl: f.masqProxyUrl.trim(),
      stringContent: f.masqString,
    },
    resolver: {
      type: f.resolverType,
      addr: f.resolverAddr.trim(),
      timeout: f.resolverTimeout.trim(),
      sni: f.resolverSni.trim(),
    },
    acl: {
      inline: f.acl
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    },
  };
}

function ConfigView() {
  const queryClient = useQueryClient();
  const config = useQuery(getConfig, {});
  const save = useMutation(updateConfig);

  const [form, setForm] = useState<ConfigForm | null>(null);
  const [notice, setNotice] = useState("");
  // Prefill once; a refetch must not clobber edits in progress.
  useEffect(() => {
    if (config.data?.structured && !form) setForm(toForm(config.data.structured));
  }, [config.data, form]);

  const set = (patch: Partial<ConfigForm>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const submit = async () => {
    if (!form) return;
    try {
      const res = await save.mutateAsync({ structured: fromForm(form) });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries();
      setForm(res.structured ? toForm(res.structured) : null);
      setNotice("Config saved — restart the core to apply");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  if (config.isPending || !form) {
    return (
      <View style={styles.center}>
        {config.isError ? (
          <>
            <Text style={styles.centerText}>{config.error.message}</Text>
            <Button mode="contained-tonal" onPress={() => config.refetch()}>
              Retry
            </Button>
          </>
        ) : (
          <ActivityIndicator />
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Banner visible={!!config.data?.managedBlocksReasserted} icon="alert">
          The panel-managed auth/trafficStats blocks were edited by hand and have been
          reasserted on the last save.
        </Banner>

        <TextInput mode="outlined" label="Listen address" placeholder=":443" value={form.listen} onChangeText={(v) => set({ listen: v })} autoCapitalize="none" style={styles.field} />

        <Text variant="titleSmall" style={styles.sectionTitle}>TLS files</Text>
        <TextInput mode="outlined" label="Certificate path" value={form.tlsCert} onChangeText={(v) => set({ tlsCert: v })} autoCapitalize="none" style={styles.field} />
        <TextInput mode="outlined" label="Key path" value={form.tlsKey} onChangeText={(v) => set({ tlsKey: v })} autoCapitalize="none" style={styles.field} />

        <Text variant="titleSmall" style={styles.sectionTitle}>Obfuscation</Text>
        <SegmentedButtons
          value={form.obfsType}
          onValueChange={(v) => set({ obfsType: v as ConfigForm["obfsType"] })}
          buttons={[
            { value: "", label: "Off" },
            { value: "salamander", label: "Salamander" },
          ]}
        />
        {form.obfsType === "salamander" && (
          <TextInput mode="outlined" label="Obfs password" value={form.obfsPassword} onChangeText={(v) => set({ obfsPassword: v })} autoCapitalize="none" style={styles.field} />
        )}

        <Text variant="titleSmall" style={styles.sectionTitle}>Bandwidth</Text>
        <View style={styles.row2}>
          <TextInput mode="outlined" label="Up" placeholder="100 mbps" value={form.bandwidthUp} onChangeText={(v) => set({ bandwidthUp: v })} autoCapitalize="none" style={styles.fieldHalf} />
          <TextInput mode="outlined" label="Down" placeholder="100 mbps" value={form.bandwidthDown} onChangeText={(v) => set({ bandwidthDown: v })} autoCapitalize="none" style={styles.fieldHalf} />
        </View>

        <Text variant="titleSmall" style={styles.sectionTitle}>Masquerade</Text>
        <SegmentedButtons
          value={form.masqType}
          onValueChange={(v) => set({ masqType: v as ConfigForm["masqType"] })}
          buttons={[
            { value: "", label: "Off" },
            { value: "proxy", label: "Proxy" },
            { value: "string", label: "String" },
          ]}
        />
        {form.masqType === "proxy" && (
          <TextInput mode="outlined" label="Proxy URL" placeholder="https://example.com" value={form.masqProxyUrl} onChangeText={(v) => set({ masqProxyUrl: v })} autoCapitalize="none" style={styles.field} />
        )}
        {form.masqType === "string" && (
          <TextInput mode="outlined" label="String content" value={form.masqString} onChangeText={(v) => set({ masqString: v })} multiline numberOfLines={2} style={styles.field} />
        )}

        <Text variant="titleSmall" style={styles.sectionTitle}>Resolver</Text>
        <SegmentedButtons
          value={["", "dns", "udp"].includes(form.resolverType) ? form.resolverType : "more"}
          onValueChange={(v) => set({ resolverType: (v === "more" ? "tcp" : v) as ConfigForm["resolverType"] })}
          buttons={[
            { value: "", label: "Off" },
            { value: "dns", label: "DNS" },
            { value: "udp", label: "UDP" },
            { value: "more", label: "TCP/TLS/HTTPS" },
          ]}
        />
        {!["", "dns", "udp"].includes(form.resolverType) && (
          <SegmentedButtons
            style={styles.field}
            value={form.resolverType}
            onValueChange={(v) => set({ resolverType: v as ConfigForm["resolverType"] })}
            buttons={[
              { value: "tcp", label: "TCP" },
              { value: "tls", label: "TLS" },
              { value: "https", label: "HTTPS" },
            ]}
          />
        )}
        {form.resolverType !== "" && (
          <>
            <TextInput mode="outlined" label="Address" placeholder="1.1.1.1:443" value={form.resolverAddr} onChangeText={(v) => set({ resolverAddr: v })} autoCapitalize="none" style={styles.field} />
            <TextInput mode="outlined" label="Timeout" placeholder="10s" value={form.resolverTimeout} onChangeText={(v) => set({ resolverTimeout: v })} autoCapitalize="none" style={styles.field} />
            {(form.resolverType === "tls" || form.resolverType === "https") && (
              <TextInput mode="outlined" label="SNI" value={form.resolverSni} onChangeText={(v) => set({ resolverSni: v })} autoCapitalize="none" style={styles.field} />
            )}
          </>
        )}

        <Text variant="titleSmall" style={styles.sectionTitle}>ACL rules (one per line)</Text>
        <TextInput
          mode="outlined"
          value={form.acl}
          onChangeText={(v) => set({ acl: v })}
          multiline
          numberOfLines={5}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.field, styles.mono]}
        />
        <HelperText type="info" visible>
          acl.file and any manual YAML keys are preserved on save.
        </HelperText>

        <Button mode="contained" onPress={submit} loading={save.isPending} disabled={save.isPending} style={styles.saveBtn}>
          Save config
        </Button>
        <Button mode="outlined" icon="code-braces" onPress={() => router.push("/config-yaml")} style={styles.field}>
          Edit raw YAML
        </Button>
      </ScrollView>
      <Snackbar visible={!!notice} onDismiss={() => setNotice("")} duration={4000}>
        {notice}
      </Snackbar>
    </KeyboardAvoidingView>
  );
}

// ---- Certificate ----

function CertView() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const cert = useQuery(getCertInfo, {});
  const gen = useMutation(generateCert);
  const restart = useMutation(restartCore);

  const [confirmGen, setConfirmGen] = useState(false);
  const [sans, setSans] = useState("");
  const [days, setDays] = useState("");
  const [notice, setNotice] = useState("");
  const [offerRestart, setOfferRestart] = useState(false);

  const submitGen = async () => {
    setConfirmGen(false);
    try {
      await gen.mutateAsync({
        sans: sans.split(",").map((s) => s.trim()).filter(Boolean),
        validityDays: Number(days) || 0,
        certPath: "",
        keyPath: "",
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries();
      setOfferRestart(true);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const copyFingerprint = async (fp: string) => {
    await Clipboard.setStringAsync(fp);
    Haptics.selectionAsync();
    setNotice("Fingerprint copied");
  };

  const d = cert.data;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {cert.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : cert.isError ? (
        <View style={styles.center}>
          <Text style={styles.centerText}>{cert.error.message}</Text>
          <Button mode="contained-tonal" onPress={() => cert.refetch()}>
            Retry
          </Button>
        </View>
      ) : d ? (
        <Card mode="contained">
          <Card.Content style={styles.certContent}>
            <View style={styles.certHeader}>
              <Chip
                compact
                icon={d.exists && !d.expired ? "check-circle" : "alert-circle"}
                style={{
                  backgroundColor:
                    d.exists && !d.expired ? theme.colors.secondaryContainer : theme.colors.errorContainer,
                }}
              >
                {!d.exists ? "No certificate" : d.expired ? "Expired" : "Valid"}
              </Chip>
            </View>
            {!!d.parseError && <Text style={{ color: theme.colors.error }}>{d.parseError}</Text>}
            {d.exists && (
              <>
                <CertRow label="Path" value={d.certPath} />
                {!!d.subjectCn && <CertRow label="Subject CN" value={d.subjectCn} />}
                {d.sans.length > 0 && <CertRow label="SANs" value={d.sans.join(", ")} />}
                <CertRow label="Valid from" value={fmtTs(d.notBefore)} />
                <CertRow label="Valid until" value={fmtTs(d.notAfter)} />
                <Text
                  variant="bodySmall"
                  style={styles.mono}
                  onPress={() => copyFingerprint(d.fingerprintSha256)}
                >
                  {d.fingerprintSha256}
                </Text>
                <HelperText type="info" visible style={styles.noPad}>
                  SHA-256 fingerprint — tap to copy. Connection links pin this value.
                </HelperText>
              </>
            )}
          </Card.Content>
        </Card>
      ) : null}

      <Divider style={styles.sectionTitle} />
      <Text variant="titleSmall">Generate new self-signed certificate</Text>
      <TextInput
        mode="outlined"
        label="SANs (optional, comma-separated)"
        placeholder="usually left empty — clients trust by pin"
        value={sans}
        onChangeText={setSans}
        autoCapitalize="none"
        style={styles.field}
      />
      <TextInput
        mode="outlined"
        label="Validity days"
        placeholder="3650"
        value={days}
        onChangeText={setDays}
        keyboardType="numeric"
        style={styles.field}
      />
      <Button
        mode="contained"
        onPress={() => setConfirmGen(true)}
        loading={gen.isPending}
        disabled={gen.isPending}
        style={styles.saveBtn}
      >
        Generate certificate
      </Button>

      <Portal>
        <Dialog visible={confirmGen} onDismiss={() => setConfirmGen(false)}>
          <Dialog.Title>Generate certificate?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              Mints a new self-signed cert and points the config at it. Existing connection
              links keep working only after a core restart, and their pinned fingerprint
              changes — clients need new links.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmGen(false)}>Cancel</Button>
            <Button onPress={submitGen}>Generate</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!notice} onDismiss={() => setNotice("")} duration={4000}>
        {notice}
      </Snackbar>
      <Snackbar
        visible={offerRestart}
        onDismiss={() => setOfferRestart(false)}
        duration={8000}
        action={{
          label: "Restart core",
          onPress: async () => {
            try {
              await restart.mutateAsync({});
              setNotice("Core restarted");
            } catch (err) {
              setNotice(err instanceof Error ? err.message : String(err));
            }
          },
        }}
      >
        Certificate generated — restart the core to apply
      </Snackbar>
    </ScrollView>
  );
}

function CertRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View>
      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
        {label}
      </Text>
      <Text variant="bodyMedium">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  segmentWrap: { paddingHorizontal: 12, paddingBottom: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  centerText: { textAlign: "center" },
  content: { padding: 12, paddingBottom: 32 },
  sectionTitle: { marginTop: 16, marginBottom: 4 },
  field: { marginTop: 8 },
  fieldHalf: { flex: 1, marginTop: 8 },
  row2: { flexDirection: "row", gap: 8 },
  mono: { fontFamily: "monospace" },
  saveBtn: { marginTop: 16 },
  certContent: { gap: 8 },
  certHeader: { flexDirection: "row" },
  noPad: { paddingHorizontal: 0 },
});
