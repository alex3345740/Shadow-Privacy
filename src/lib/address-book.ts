export type AddressBookContact = {
  id: string;
  name: string;
  address: string;
  tags: string[];
  note?: string;
  createdAt: number;
};

const KEY = "shadowprivacy.addressbook.v1";

function readRaw(): AddressBookContact[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as AddressBookContact[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(items: AddressBookContact[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(items.slice(0, 200)));
}

export function listContacts() {
  return readRaw();
}

export function upsertContact(contact: AddressBookContact) {
  const existing = readRaw();
  const next = existing.filter((item) => item.id !== contact.id);
  next.unshift(contact);
  writeRaw(next);
}

export function deleteContact(id: string) {
  const next = readRaw().filter((item) => item.id !== id);
  writeRaw(next);
}

export function searchContacts(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return listContacts();
  return listContacts().filter((item) => {
    return (
      item.name.toLowerCase().includes(q) ||
      item.address.toLowerCase().includes(q) ||
      item.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  });
}
