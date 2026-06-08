export function ApiBaseScript() {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBaseUrl) return null;

  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `window.MAP_OF_US_API_BASE_URL=${JSON.stringify(apiBaseUrl)};`,
      }}
    />
  );
}
