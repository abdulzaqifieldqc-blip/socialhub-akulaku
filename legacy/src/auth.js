import jwt from "jsonwebtoken";

export function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "12h", issuer: "social-hub" }
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Silakan login." });
  try {
    req.auth = jwt.verify(token, process.env.JWT_SECRET, { issuer: "social-hub" });
    next();
  } catch {
    return res.status(401).json({ error: "Sesi tidak valid atau kedaluwarsa." });
  }
}

export function requireAdmin(req, res, next) {
  if (!["owner", "admin"].includes(req.auth?.role)) {
    return res.status(403).json({ error: "Akses khusus admin." });
  }
  next();
}
