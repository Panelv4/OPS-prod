// Historical fixtures had shared passwords. Even if an operator points a hardened server at an old DB,
// they are not valid production identities. Do not delete or mutate legacy business records here.
const reserved = new Set([
  "arjun@meridianstudio.in",
  "kavya@meridianstudio.in",
  "ananya@meridianstudio.in",
  "rohan@meridianstudio.in",
  "dev@meridianstudio.in",
  "priya@northstarlabs.in",
]);
export function isReservedDemoEmail(email: string) {
  return (
    process.env.NODE_ENV === "production" && reserved.has(email.toLowerCase())
  );
}
