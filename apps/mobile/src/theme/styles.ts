import { StyleSheet } from "react-native";
import { theme } from "./tokens";

export const styles = StyleSheet.create({
  actionCard: {
    gap: theme.space.medium,
  },
  button: {
    alignItems: "center",
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.control,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: theme.space.medium,
    paddingVertical: 12,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: theme.color.panel,
    fontSize: 14,
    fontWeight: "600",
  },
  card: {
    backgroundColor: theme.color.panel,
    borderColor: theme.color.border,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    gap: theme.space.medium,
    overflow: "hidden",
    padding: 20,
  },
  contentColumn: {
    alignSelf: "center",
    gap: 20,
    maxWidth: 640,
    width: "100%",
  },
  divider: {
    backgroundColor: "#f5f5f5",
    height: 1,
  },
  error: {
    color: theme.color.danger,
    fontSize: 14,
  },
  heading: {
    color: theme.color.text,
    fontSize: 20,
    fontWeight: "600",
    letterSpacing: -0.25,
  },
  label: {
    color: theme.color.text,
    fontSize: 14,
  },
  muted: {
    color: theme.color.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  outlineButton: {
    backgroundColor: theme.color.panel,
    borderColor: "#d4d4d4",
    borderWidth: 1,
  },
  outlineButtonText: {
    color: theme.color.text,
  },
  page: {
    backgroundColor: theme.color.canvas,
    flex: 1,
  },
  pageContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingBottom: theme.space.xlarge,
    paddingHorizontal: theme.space.medium,
    paddingTop: theme.space.xlarge,
  },
  previousPrice: {
    color: theme.color.muted,
    fontSize: 14,
    textDecorationLine: "line-through",
    textDecorationStyle: "solid",
  },
  price: {
    color: theme.color.text,
    fontSize: 24,
    fontWeight: "600",
    letterSpacing: -0.4,
  },
  priceRow: {
    alignItems: "baseline",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.space.small,
  },
  section: {
    gap: theme.space.small,
  },
  statusBody: {
    color: "#404040",
    fontSize: 14,
    lineHeight: 20,
  },
  statusConnection: {
    color: theme.color.muted,
    fontSize: 12,
    marginTop: theme.space.xsmall,
  },
  statusDanger: {
    backgroundColor: theme.color.dangerBackground,
    borderColor: theme.color.dangerBorder,
  },
  statusHeading: {
    color: theme.color.text,
    fontSize: 16,
    fontWeight: "600",
  },
  statusInfo: {
    backgroundColor: theme.color.infoBackground,
    borderColor: theme.color.infoBorder,
  },
  statusNeutral: {
    backgroundColor: theme.color.neutralBackground,
    borderColor: theme.color.neutralBorder,
  },
  statusPanel: {
    borderRadius: theme.radius.card,
    borderWidth: 1,
    gap: theme.space.xsmall,
    padding: theme.space.medium,
  },
  statusSuccess: {
    backgroundColor: theme.color.successBackground,
    borderColor: theme.color.successBorder,
  },
  statusWarning: {
    backgroundColor: theme.color.warningBackground,
    borderColor: theme.color.warningBorder,
  },
  success: {
    color: theme.color.success,
    fontSize: 14,
  },
  title: {
    color: theme.color.text,
    fontSize: 18,
    fontWeight: "600",
  },
});
