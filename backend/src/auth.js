import { supabase } from '../supabase.js';
import { verifyToken, isAdminEmail } from '../utils/hash.js';

export async function authMiddleware(req, res, next){
  const auth = req.headers.authorization;
  if(!auth) return res.status(401).json({ error: 'Missing token' });
  const token = auth.replace('Bearer ','');
  const decoded = verifyToken(token);
  if(!decoded) return res.status(401).json({ error: 'Invalid token' });

  const { data: user, error } = await supabase.from('users').select('*').eq('id', decoded.id).single();
  if(error || !user) return res.status(401).json({ error: 'User not found' });
  if(user.status === 'BLOCKED') return res.status(403).json({ error: 'Account blocked' });

  req.user = user;
  req.userDecoded = decoded;
  next();
}

export function adminMiddleware(req, res, next){
  if(!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if(!isAdminEmail(req.user.email) && !req.user.is_admin){
    return res.status(403).json({ error: 'Not admin' });
  }
  next();
}
