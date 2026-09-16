/** API seeding for the E2E specs: hospital, catalog, doctor, patient. */

const API = "http://localhost:8124";

export interface Seed {
  tag: string;
  specialty: string;
  doctorName: string;
  patientEmail: string;
  password: string;
  patientToken: string;
  ownerToken: string;
}

async function post(path: string, body: unknown, token?: string): Promise<any> {
  const res = await fetch(API + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${path}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function seed(tag: string): Promise<Seed> {
  const uid = Math.random().toString(36).slice(2, 8);
  const password = "correct-horse-42";
  // Unique per run: reruns never match stale rows from earlier attempts.
  const specialty = `Cardiology e2e ${tag} ${uid}`;
  const doctorName = `Dr. E2E ${tag} ${uid}`;

  const reg = await post("/hospitals", {
    name: `E2E ${tag} ${uid}`,
    address: "1 Main St",
    contact_email: `c-${tag}-${uid}@example.com`,
    contact_phone: "+1-555-0100",
    admin_email: `a-${tag}-${uid}@example.com`,
    admin_password: password,
  });
  const rootEmail = `root-${tag}-${uid}@example.com`;
  await post("/auth/register", {
    email: rootEmail,
    password,
    role: "platform_admin",
  });
  const ptok = await post("/auth/login", { email: rootEmail, password });
  await post(`/platform/hospitals/${reg.id}/approve`, {}, ptok.access_token);

  const atok = await post("/auth/login", {
    email: `a-${tag}-${uid}@example.com`,
    password,
  });
  const spec = await post(
    `/hospitals/${reg.id}/specialties`,
    { name: specialty },
    atok.access_token,
  );
  const dept = await post(
    `/hospitals/${reg.id}/departments`,
    { name: `Heart ${tag}` },
    atok.access_token,
  );
  const typ = await post(
    `/hospitals/${reg.id}/appointment-types`,
    { name: `Consult ${tag}`, duration_minutes: 30 },
    atok.access_token,
  );
  const doc = await post(
    `/hospitals/${reg.id}/doctors`,
    { name: doctorName, specialty_id: spec.id, department_id: dept.id },
    atok.access_token,
  );
  await post(
    `/hospitals/${reg.id}/doctors/${doc.id}/activate`,
    {},
    atok.access_token,
  );
  await post(
    `/hospitals/${reg.id}/doctors/${doc.id}/availability-rules`,
    {
      day_of_week: 0,
      start_time: "09:00:00",
      end_time: "17:00:00",
      recurrence: "weekly",
    },
    atok.access_token,
  );

  const patientEmail = `p-${tag}-${uid}@example.com`;
  await post("/auth/register", {
    email: patientEmail,
    password,
    role: "patient",
  });
  const pat = await post("/auth/login", { email: patientEmail, password });

  return {
    tag,
    specialty,
    doctorName,
    patientEmail,
    password,
    patientToken: pat.access_token,
    ownerToken: atok.access_token,
  };
}

export async function setFaultMode(mode: string): Promise<void> {
  const res = await fetch(`${API}/mock-ehr/_debug/fault-mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) {
    throw new Error(`fault-mode ${mode}: ${res.status} ${await res.text()}`);
  }
}

export async function apiGet(path: string, token: string): Promise<any> {
  const res = await fetch(API + path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function apiPost(
  path: string,
  body: unknown,
  token: string,
): Promise<any> {
  const res = await fetch(API + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${path}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}
