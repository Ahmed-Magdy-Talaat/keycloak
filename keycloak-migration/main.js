async function main() {
  const realms = [
    "73288cd5-ceef-4eb1-921c-211d0beebaa3",
    "8f370ac2-39c8-4dec-8504-cb1cf8ceebb4",
    "a27eb3a1-d712-4955-abae-558946797da4",
  ];

  for (const realm of realms) {
    try {
      const token = await getAccessToken();
      await createTenant(token);
      await updateUsersAndRoles(token);
    } catch (error) {
      console.error("An error occurred:", error);
    }
  }
}
