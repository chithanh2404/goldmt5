import { useState, useEffect, useRef, memo, useCallback } from 'react';
import { api, getProfits } from './lib/api.js';

// === TOAST ===
function ToastContainer({toasts, removeToast}){
  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-3 pointer-events-none">
      {toasts.map(t=>(
        <div key={t.id} className={`pointer-events-auto min-w-[340px] max-w-[440px] rounded-2xl border backdrop-blur-2xl p-4 shadow-[0_20px_60px_rgba(0,0,0,0.5)] flex gap-3 items-start relative overflow-hidden ${t.type==='success'?'bg-[#0a1f14] border-emerald-500/50 text-white':t.type==='error'?'bg-[#1f0a0a] border-red-500/50 text-white':'bg-[#0f0f1f] border-violet-500/50 text-white'}`} style={{animation:'toastIn 0.4s ease'}}>
          <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-black ${t.type==='success'?'bg-emerald-500 text-black':t.type==='error'?'bg-red-500 text-white':'bg-violet-500 text-white'}`}>{t.type==='success'?'✓':t.type==='error'?'✕':'ℹ'}</div>
          <div className="flex-1 pr-2"><p className="text-[13px] font-black text-white leading-tight">{t.title}</p><p className="text-[12px] text-zinc-100 mt-1 leading-snug font-medium">{t.message}</p></div>
          <button onClick={()=>removeToast(t.id)} className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-all flex-shrink-0">✕</button>
          <div className="absolute bottom-0 left-0 h-1 bg-current opacity-60 rounded-b-2xl" style={{animation:'progressShrink 4s linear forwards'}}></div>
        </div>
      ))}
    </div>
  );
}

function GoldModal({children, onClose}){
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose}></div>
      <div className="modal-gold-wrapper relative w-full max-w-5xl max-h-[90vh] overflow-auto" style={{animation:'slideUp 0.4s ease'}}>
        <div className="modal-gold-inner p-6 text-white">
          <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center">✕</button>
          {children}
        </div>
      </div>
    </div>
  );
}

// === PROFIT CHART ===
const ProfitChart = memo(function ProfitChart({profits}){
  const [mode, setMode] = useState('percent');
  const [range, setRange] = useState('all');
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  const filtered = (() => {
    if(!profits || profits.length===0) return [];
    const sorted = [...profits].sort((a,b)=>{
      const ta = a.timestamp_ms || (a.timestamp ? new Date(a.timestamp).getTime() : 0) || 0;
      const tb = b.timestamp_ms || (b.timestamp ? new Date(b.timestamp).getTime() : 0) || 0;
      return ta-tb;
    });
    if(range==='all') return sorted;
    const now = Date.now();
    let ms = range==='1d'?86400000: range==='7d'?7*86400000:30*86400000;
    return sorted.filter(p=> (p.timestamp_ms||new Date(p.timestamp).getTime()) >= now-ms);
  })();

  useEffect(()=>{
    if(!canvasRef.current || !filtered.length) return;
    if(!window.Chart) {
      // dynamic load chart.js via CDN fallback if not bundled
      return;
    }
    if(chartRef.current){ try{chartRef.current.destroy();}catch(e){} }
    const ctx = canvasRef.current.getContext('2d');
    const grad = ctx.createLinearGradient(0,0,0,220);
    if(mode==='percent'){ grad.addColorStop(0,'rgba(234,179,8,0.35)'); grad.addColorStop(1,'rgba(0,0,0,0)'); }
    else { grad.addColorStop(0,'rgba(16,185,129,0.35)'); grad.addColorStop(1,'rgba(0,0,0,0)'); }

    const values = mode==='percent' ? filtered.map(p=>p.percent||p.daily_percent||0) : filtered.map(p=>p.total_profit||p.profit||p.daily_profit||0);
    const labels = filtered.map(p=>{
      const d = p.timestamp ? new Date(p.timestamp) : new Date(p.timestamp_ms);
      return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
    });

    chartRef.current = new window.Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{ label: mode==='percent'?'% Profit':'$ Profit', data: values, borderColor: mode==='percent'?'#eab308':'#10b981', backgroundColor: grad, fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888', maxTicksLimit: 8 } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888' } }
        }
      }
    });
  }, [filtered, mode]);

  // If Chart.js not loaded via window, fallback to simple canvas via react-chartjs-2
  // For simplicity we use window.Chart loaded from CDN in index.html? We'll load via import if needed.

  return (
    <div className="p-4 rounded-2xl border bg-[#15151f] border-[#23232f]">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-bold text-amber-400">📈 Lợi nhuận Bot Gold MT5</h3>
        <div className="flex gap-2">
          <select value={range} onChange={e=>setRange(e.target.value)} className="bg-[#0e0e16] border border-[#23232f] text-xs rounded-full px-3 py-1">
            <option value="1d">1 Ngày</option><option value="7d">7 Ngày</option><option value="30d">30 Ngày</option><option value="all">Tất cả</option>
          </select>
          <button onClick={()=>setMode(mode==='percent'?'dollar':'percent')} className="btn-gold-outline text-[11px] py-1 px-3">{mode==='percent'?'Xem $':'Xem %'}</button>
        </div>
      </div>
      <div className="h-[280px] relative">
        <canvas ref={canvasRef}></canvas>
        {filtered.length===0 && <p className="absolute inset-0 flex items-center justify-center text-xs opacity-60">Chưa có dữ liệu profit</p>}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 text-[11px]">
        <div className="p-2 rounded-xl bg-[#0e0e16] border border-[#23232f]"><p className="opacity-60">Tổng bản ghi</p><p className="font-black text-amber-400">{profits.length}</p></div>
        <div className="p-2 rounded-xl bg-[#0e0e16] border border-[#23232f]"><p className="opacity-60">Profit mới nhất</p><p className="font-black text-emerald-400">${(profits[profits.length-1]?.total_profit||0).toFixed(2)}</p></div>
        <div className="p-2 rounded-xl bg-[#0e0e16] border border-[#23232f]"><p className="opacity-60">% mới nhất</p><p className="font-black text-violet-400">{(profits[profits.length-1]?.percent||0).toFixed(2)}%</p></div>
      </div>
    </div>
  );
});

// === MAIN APP ===
export default function App(){
  const [theme] = useState('dark');
  const [view, setView] = useState('login'); // login, register, dashboard, admin
  const [user, setUser] = useState(null);
  const [profits, setProfits] = useState([]);
  const [myData, setMyData] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [adminData, setAdminData] = useState(null);
  const [walletAssign, setWalletAssign] = useState(null);
  const [showBankModal, setShowBankModal] = useState(false);
  const [showInvestModal, setShowInvestModal] = useState(false);
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [payoutPreview, setPayoutPreview] = useState(null);

  // form states
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ email: '', fullName: '', password: '', confirmPassword: '' });
  const [investAmount, setInvestAmount] = useState('');
  const [bankForm, setBankForm] = useState({ bankName:'', accountNumber:'', accountHolder:'', usdtNetwork:'TRC20', usdtAddress:'', preferredPayout:'BANK' });

  const showToast = (msg, type='info', title='')=>{
    const id = Date.now()+Math.random();
    setToasts(t=>[...t, { id, title: title|| (type==='success'?'Thành công':type==='error'?'Lỗi':'Thông báo'), message: msg, type }]);
    setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)), 4000);
  };
  const removeToast = (id)=> setToasts(t=>t.filter(x=>x.id!==id));

  // Load profits
  useEffect(()=>{
    getProfits().then(setProfits);
    const iv = setInterval(()=> getProfits().then(setProfits), 60000);
    return ()=>clearInterval(iv);
  },[]);

  // Check token on mount
  useEffect(()=>{
    const token = localStorage.getItem('investor_token');
    if(token){
      api.get('/user/my-data').then(r=>{
        if(r.data && r.data.success){
          setMyData(r.data);
          setUser(JSON.parse(localStorage.getItem('investor_user')||'{}'));
          setBankForm({ bankName: r.data.bankInfo?.bankName||'', accountNumber: r.data.bankInfo?.accountNumber||'', accountHolder: r.data.bankInfo?.accountHolder||'', usdtNetwork: r.data.usdtInfo?.network||'TRC20', usdtAddress: r.data.usdtInfo?.address||'', preferredPayout: r.data.preferredPayout||'BANK' });
          setView('dashboard');
        }
      }).catch(()=>{ localStorage.removeItem('investor_token'); });
    }
  },[]);

  // Ensure Chart.js from CDN for chart
  useEffect(()=>{
    if(!window.Chart){
      const s = document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js';
      document.head.appendChild(s);
    }
  },[]);

  const handleLogin = async (e)=>{
    e.preventDefault();
    setLoading(true);
    try{
      const { data } = await api.post('/auth/login', loginForm);
      if(data.error) { showToast(data.error,'error'); }
      else {
        localStorage.setItem('investor_token', data.token);
        localStorage.setItem('investor_user', JSON.stringify(data.user));
        setUser(data.user);
        const my = await api.get('/user/my-data');
        if(my.data.success) {
          setMyData(my.data);
          setBankForm({ bankName: my.data.bankInfo?.bankName||'', accountNumber: my.data.bankInfo?.accountNumber||'', accountHolder: my.data.bankInfo?.accountHolder||'', usdtNetwork: my.data.usdtInfo?.network||'TRC20', usdtAddress: my.data.usdtInfo?.address||'', preferredPayout: my.data.preferredPayout||'BANK' });
        }
        showToast(`Chào mừng ${data.user.fullName}!`,'success','Đăng nhập thành công');
        setView(data.user.isAdmin ? 'admin' : 'dashboard');
        if(data.user.isAdmin) loadAdmin();
      }
    }catch(err){ showToast(err.response?.data?.error||err.message,'error'); }
    setLoading(false);
  };

  const handleRegister = async (e)=>{
    e.preventDefault();
    setLoading(true);
    try{
      const { data } = await api.post('/auth/register', registerForm);
      if(data.error) showToast(data.error,'error');
      else { showToast('Đăng ký thành công! Hãy đăng nhập.','success'); setView('login'); }
    }catch(err){ showToast(err.message,'error'); }
    setLoading(false);
  };

  const loadAdmin = async ()=>{
    const { data } = await api.get('/admin-all');
    if(data.success) setAdminData(data);
  };

  const handleRequestWallet = async ()=>{
    const amt = parseFloat(investAmount);
    if(!amt) { showToast('Nhập số tiền','warning'); return; }
    setLoading(true);
    try{
      const { data } = await api.post('/wallet/request-wallet', { amount: amt });
      if(data.error) showToast(data.error,'error');
      else {
        setWalletAssign(data.wallet);
        showToast(`Đã cấp ví ${data.wallet.label}`,'success');
      }
    }catch(e){ showToast(e.response?.data?.error||e.message,'error'); }
    setLoading(false);
  };

  const handleConfirmInvest = async ()=>{
    if(!walletAssign) return;
    setLoading(true);
    try{
      const { data } = await api.post('/wallet/add-investment', { amount: walletAssign.amount, walletId: walletAssign.id });
      if(data.error) showToast(data.error,'error');
      else {
        showToast(`Đã tạo yêu cầu đầu tư $${walletAssign.amount} - chờ duyệt / auto-check`,'success');
        setShowInvestModal(false);
        setWalletAssign(null);
        setInvestAmount('');
        const my = await api.get('/user/my-data');
        if(my.data.success) setMyData(my.data);
      }
    }catch(e){ showToast(e.message,'error'); }
    setLoading(false);
  };

  const handleUpdateBank = async ()=>{
    setLoading(true);
    try{
      const { data } = await api.post('/user/update-payout-info', bankForm);
      if(data.error) showToast(data.error,'error');
      else { showToast('Đã cập nhật thông tin thanh toán','success'); setShowBankModal(false); const my=await api.get('/user/my-data'); if(my.data.success) setMyData(my.data); }
    }catch(e){ showToast(e.message,'error'); }
    setLoading(false);
  };

  const handlePayoutPreview = async (totalProfit)=>{
    setLoading(true);
    try{
      const { data } = await api.post('/payout-preview', { totalProfit });
      if(data.error) showToast(data.error,'error');
      else setPayoutPreview(data);
    }catch(e){ showToast(e.message,'error'); }
    setLoading(false);
  };

  const handleConfirmPayout = async (item)=>{
    if(!payoutPreview) return;
    setLoading(true);
    try{
      const { data } = await api.post('/confirm-payout', { userId: item.userId, amount: item.payoutAmount, totalProfit: payoutPreview.totalProfit, payoutMethod: item.preferredPayout, note: 'Trả lãi tự động từ admin' });
      if(data.error) showToast(data.error,'error');
      else { showToast(`Đã trả $${item.payoutAmount.toFixed(2)} cho ${item.fullName}`,'success'); loadAdmin(); }
    }catch(e){ showToast(e.message,'error'); }
    setLoading(false);
  };

  // Render helpers
  const totalInvested = myData?.stats?.totalInvested||0;
  const sharePercent = myData?.stats?.sharePercent||0;
  const ROI = myData?.stats?.ROI||0;

  return (
    <div className={`min-h-screen ${theme==='dark'?'bg-[#0a0a0f] text-white':'bg-zinc-50 text-black'} font-sans`}>
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#0a0a0f]/80 border-b border-[#23232f] px-4 py-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <img src="https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEgQ8VR044Lm4scW0WGoRzlpZ9HzbBxck4F0iVJTh1t5cYw7Dk3x3r_yHKsTcHPlQyJzfm2WdHu9Xi5NW8tAdMFQHxwCfcgEKFf5OaL2ktkCEkhMEGrUiM23bwsM6_ZhLUtL4wf-0CQ1J3q0c-nzFc3tZkpEmJmrEdNzkCmmmp6RUXGFRfm_e8tXNx5Rc5k/s192/logo%20Gold%20Bot%20Trade.png" className="w-9 h-9 rounded-full border border-amber-500/50" alt="logo" />
          <div><p className="font-black text-sm leading-none tracking-wide">GOLD MT5 ULTIMATE</p><p className="text-[10px] opacity-60 mono">Investor System • Supabase v1</p></div>
        </div>
        <div className="flex gap-2">
          {user ? <>
            <span className="text-[11px] px-3 py-1 rounded-full bg-[#1a1a24] border border-[#23232f]">{user.email}</span>
            {user.isAdmin && <button onClick={()=>{setView('admin'); loadAdmin();}} className="btn-gold-outline text-xs">Admin</button>}
            <button onClick={()=>setView('dashboard')} className="btn-gold-outline text-xs">Dashboard</button>
            <button onClick={()=>{localStorage.clear(); setUser(null); setMyData(null); setView('login');}} className="bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 px-3 py-1 rounded-full text-xs">Thoát</button>
          </> : <>
            <button onClick={()=>setView('login')} className={`px-4 py-1.5 rounded-full text-xs font-bold ${view==='login'?'btn-gold':'btn-gold-outline'}`}>Đăng nhập</button>
            <button onClick={()=>setView('register')} className={`px-4 py-1.5 rounded-full text-xs font-bold ${view==='register'?'btn-gold':'btn-gold-outline'}`}>Đăng ký</button>
          </>}
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 space-y-4">
        {/* Profit chart always visible */}
        <ProfitChart profits={profits} />

        {view==='login' && (
          <div className="max-w-md mx-auto p-6 rounded-2xl border bg-[#15151f] border-[#23232f]">
            <h2 className="text-xl font-black mb-1">Đăng nhập</h2><p className="text-xs opacity-60 mb-4">Hệ thống quản lý vốn Gold MT5 • Supabase + OnRender</p>
            <form onSubmit={handleLogin} className="space-y-3">
              <input value={loginForm.email} onChange={e=>setLoginForm({...loginForm,email:e.target.value})} placeholder="Email" className="w-full bg-[#0e0e16] border border-[#23232f] rounded-xl px-4 py-3 text-sm outline-none focus:border-amber-500" />
              <input value={loginForm.password} onChange={e=>setLoginForm({...loginForm,password:e.target.value})} type="password" placeholder="Mật khẩu" className="w-full bg-[#0e0e16] border border-[#23232f] rounded-xl px-4 py-3 text-sm outline-none focus:border-amber-500" />
              <button disabled={loading} type="submit" className="btn-gold w-full justify-center">{loading?'Đang đăng nhập...':'Đăng nhập'}</button>
            </form>
          </div>
        )}

        {view==='register' && (
          <div className="max-w-md mx-auto p-6 rounded-2xl border bg-[#15151f] border-[#23232f]">
            <h2 className="text-xl font-black mb-4">Tạo tài khoản</h2>
            <form onSubmit={handleRegister} className="space-y-3">
              <input value={registerForm.fullName} onChange={e=>setRegisterForm({...registerForm,fullName:e.target.value})} placeholder="Họ tên" className="w-full bg-[#0e0e16] border border-[#23232f] rounded-xl px-4 py-3 text-sm" />
              <input value={registerForm.email} onChange={e=>setRegisterForm({...registerForm,email:e.target.value})} placeholder="Email" className="w-full bg-[#0e0e16] border border-[#23232f] rounded-xl px-4 py-3 text-sm" />
              <input value={registerForm.password} onChange={e=>setRegisterForm({...registerForm,password:e.target.value})} type="password" placeholder="Mật khẩu" className="w-full bg-[#0e0e16] border border-[#23232f] rounded-xl px-4 py-3 text-sm" />
              <input value={registerForm.confirmPassword} onChange={e=>setRegisterForm({...registerForm,confirmPassword:e.target.value})} type="password" placeholder="Nhập lại mật khẩu" className="w-full bg-[#0e0e16] border border-[#23232f] rounded-xl px-4 py-3 text-sm" />
              <button disabled={loading} className="btn-gold w-full">{loading?'Đang tạo...':'Đăng ký'}</button>
            </form>
          </div>
        )}

        {view==='dashboard' && myData && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-2xl border bg-[#15151f] border-[#23232f]"><p className="text-xs opacity-60">Tổng vốn APPROVED</p><p className="text-2xl font-black text-amber-400">${totalInvested.toLocaleString()}</p><p className="text-[11px] opacity-60 mt-1">{sharePercent.toFixed(2)}% tổng pool</p></div>
              <div className="p-4 rounded-2xl border bg-[#15151f] border-[#23232f]"><p className="text-xs opacity-60">Tổng lãi đã nhận</p><p className="text-2xl font-black text-emerald-400">${(myData.stats.totalProfitReceived||0).toFixed(2)}</p><p className="text-[11px] opacity-60 mt-1">ROI {ROI.toFixed(2)}%</p></div>
              <div className="p-4 rounded-2xl border bg-[#15151f] border-[#23232f] flex flex-col gap-2"><p className="text-xs opacity-60">Hành động</p><div className="flex gap-2"><button onClick={()=>setShowInvestModal(true)} className="btn-gold text-xs">💰 Nạp đầu tư</button><button onClick={()=>setShowBankModal(true)} className="btn-gold-outline text-xs">🏦 Bank/USDT</button></div><p className="text-[10px] opacity-50">Nạp qua USDT BEP20 - auto-check BSCScan mỗi phút</p></div>
            </div>

            <div className="p-4 rounded-2xl border bg-[#15151f] border-[#23232f]">
              <h4 className="font-bold mb-3">Lịch sử đầu tư</h4>
              <div className="space-y-2 max-h-80 overflow-auto thin-scrollbar">
                {myData.investments.length===0 && <p className="text-xs opacity-60 text-center py-6">Chưa có đầu tư nào</p>}
                {myData.investments.map(inv=>(
                  <div key={inv.id} className="flex justify-between items-center p-3 rounded-xl bg-[#0e0e16] border border-[#1e1e2f] text-sm">
                    <div><p className="font-bold">${inv.amount} - <span className={`${inv.status==='APPROVED'?'text-emerald-400':inv.status==='PENDING'?'text-amber-400':'text-red-400'}`}>{inv.status}</span></p><p className="text-[11px] opacity-60 mono">{inv.wallet_info?.label||''} {inv.wallet_info?.address?.slice(0,12)}... • {new Date(inv.created_at).toLocaleString('vi-VN')}</p></div>
                    {inv.tx_hash && <a href={`https://bscscan.com/tx/${inv.tx_hash}`} target="_blank" className="text-[11px] text-violet-400 hover:underline">Tx</a>}
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 rounded-2xl border bg-[#15151f] border-[#23232f]">
              <h4 className="font-bold mb-3">Lịch sử trả lãi</h4>
              <div className="overflow-auto">
                <table className="w-full text-[11px] mono"><thead><tr className="opacity-60 border-b"><th className="text-left py-2">Ngày</th><th>Số tiền</th><th>Phương thức</th><th>Ghi chú</th></tr></thead><tbody>{myData.payouts.map(p=><tr key={p.id} className="border-b border-[#1e1e2f]"><td className="py-2">{new Date(p.created_at).toLocaleDateString('vi-VN')}</td><td className="font-black text-emerald-400">${p.amount}</td><td>{p.payout_method}</td><td className="opacity-60">{p.note}</td></tr>)}</tbody></table>
                {myData.payouts.length===0 && <p className="text-center text-xs opacity-60 py-4">Chưa có lần trả lãi nào</p>}
              </div>
            </div>
          </div>
        )}

        {view==='admin' && (
          <div className="space-y-4">
            {!adminData ? <p className="text-center py-10 opacity-60">Đang tải dữ liệu admin...</p> : <>
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 rounded-2xl border bg-[#15151f] border-[#23232f]"><p className="text-xs opacity-60">Users</p><p className="text-2xl font-black">{adminData.users.length}</p></div>
                <div className="p-4 rounded-2xl border bg-[#15151f] border-[#23232f]"><p className="text-xs opacity-60">Tổng Pool</p><p className="text-xl font-black text-amber-400">${adminData.users.reduce((s,u)=>s+(u.investments?.filter(i=>i.status==='APPROVED').reduce((a,b)=>a+b.amount,0)||0),0).toLocaleString()}</p></div>
                <div className="p-4 rounded-2xl border bg-[#15151f] border-[#23232f]"><p className="text-xs opacity-60">Tổng Profit Records</p><p className="text-xl font-black text-emerald-400">{adminData.profits.length}</p></div>
              </div>

              <div className="p-4 rounded-2xl border bg-[#1a1608] border-[#2a2410] flex justify-between items-center">
                <div><h4 className="font-bold text-amber-400">Trả lãi theo % vốn</h4><p className="text-[11px] opacity-60">Tính (Vốn user / Tổng Pool) * Profit Bot</p></div>
                <button onClick={()=>setShowPayoutModal(true)} className="btn-gold px-5 py-2.5 text-xs">💸 Trả lãi ngay</button>
              </div>

              {/* Wallets */}
              <div className="p-4 rounded-2xl border bg-[#15151f] border-[#23232f]">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="font-bold">Quản lý ví USDT BEP20 ({adminData.depositWallets.length} ví)</h4>
                  <div className="flex gap-2">
                    <button onClick={async()=>{ const {data}=await api.post('/auto-check'); showToast(data.message||'Đã chạy auto-check','success'); loadAdmin(); }} className="btn-gold-outline text-xs">🤖 Chạy auto-check</button>
                    <button onClick={async()=>{ const {data}=await api.get('/deposit-logs'); console.log(data); showToast(`${data.logs?.length||0} logs trong console`,'info'); }} className="btn-gold-outline text-xs">📜 Logs</button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-64 overflow-auto thin-scrollbar">
                  {adminData.depositWallets.map(w=>(
                    <div key={w.id} className={`p-3 rounded-xl border text-xs ${w.status==='BUSY'?'bg-amber-950/20 border-amber-800/30':'bg-[#0e0e16] border-[#1e1e2f]'}`}>
                      <p className="font-bold">{w.label} - {w.network} - <span className={w.status==='BUSY'?'text-amber-400':'text-emerald-400'}>{w.status}</span></p>
                      <p className="mono text-[10px] opacity-60 break-all">{w.address}</p>
                      {w.status==='BUSY' && <p className="mt-1">👤 {w.busy_by_email} - ${w.busy_amount} - {w.assigned_at? new Date(w.assigned_at).toLocaleString('vi-VN'):''}</p>}
                      <p className="opacity-60">Đã nhận: ${w.total_received}</p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={async()=>{ await api.post('/wallet/admin/free',{walletId:w.id}); loadAdmin(); }} className="text-[11px] px-2 py-1 rounded-full bg-zinc-800">Giải phóng</button>
                        <button onClick={async()=>{ if(confirm('Xóa ví?')){ await api.post('/wallet/admin/delete',{walletId:w.id}); loadAdmin(); } }} className="text-[11px] px-2 py-1 rounded-full bg-red-900/30 text-red-400">Xóa</button>
                      </div>
                    </div>
                  ))}
                </div>
                <form onSubmit={async e=>{ e.preventDefault(); const fd=new FormData(e.target); const addr=fd.get('address'); const label=fd.get('label'); const {data}=await api.post('/wallet/admin/add',{network:'BEP20',address:addr,label}); if(data.error) showToast(data.error,'error'); else {showToast('Đã thêm ví','success'); loadAdmin(); e.target.reset();} }} className="mt-3 flex gap-2">
                  <input name="address" placeholder="Địa chỉ ví BEP20" className="flex-1 bg-[#0e0e16] border border-[#23232f] rounded-full px-4 py-2 text-xs" required />
                  <input name="label" placeholder="Nhãn" className="w-32 bg-[#0e0e16] border border-[#23232f] rounded-full px-4 py-2 text-xs" />
                  <button className="btn-gold text-xs">Thêm ví</button>
                </form>
              </div>

              {/* Pending investments */}
              <div className="p-4 rounded-2xl border bg-[#15151f] border-[#23232f]">
                <h4 className="font-bold mb-3">Duyệt đầu tư - chờ duyệt: {adminData.users.flatMap(u=>u.investments.filter(i=>i.status==='PENDING')).length}</h4>
                <div className="space-y-2 max-h-80 overflow-auto thin-scrollbar">
                  {adminData.users.flatMap(u=>u.investments.filter(i=>i.status==='PENDING').map(i=>({...i,userName:u.full_name||u.email,userEmail:u.email,userId:u.id}))).map(p=>(
                    <div key={p.id} className="flex justify-between items-center p-3 rounded-xl bg-[#0e0e16] border border-[#1e1e2f] text-sm">
                      <div><p className="font-semibold">{p.userName} - ${p.amount}</p><p className="text-[11px] opacity-60">{p.userEmail} • {p.wallet_info?.label}</p></div>
                      <div className="flex gap-2"><button onClick={async()=>{ await api.post('/admin-approve',{userId:p.userId,investId:p.id,status:'APPROVED'}); showToast('Đã duyệt','success'); loadAdmin(); }} className="btn-gold px-4 py-1.5 text-xs">Duyệt</button><button onClick={async()=>{ await api.post('/admin-approve',{userId:p.userId,investId:p.id,status:'REJECTED'}); showToast('Đã từ chối','info'); loadAdmin(); }} className="bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 rounded-full text-xs font-bold">Từ chối</button></div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Users table */}
              <div className="p-4 rounded-2xl border bg-[#15151f] border-[#23232f] overflow-auto">
                <h4 className="font-bold mb-3">Toàn bộ user</h4>
                <table className="w-full text-[11px] mono"><thead><tr className="opacity-60 border-b"><th className="text-left py-2">User</th><th>Vốn</th><th>% Pool</th><th>Bank</th></tr></thead><tbody>{adminData.users.map(u=>{ const cap=u.investments.filter(i=>i.status==='APPROVED').reduce((a,b)=>a+b.amount,0); const totalPool=adminData.users.reduce((s,x)=>s+x.investments.filter(i=>i.status==='APPROVED').reduce((a,b)=>a+b.amount,0),0); const pct=totalPool?cap/totalPool*100:0; return <tr key={u.id} className="border-b border-[#1e1e2f]"><td className="py-2"><p className="font-bold">{u.full_name||u.email}</p><p className="text-[10px] opacity-60">{u.email}</p></td><td className="font-bold">${cap}</td><td className="text-amber-400">{pct.toFixed(2)}%</td><td>{u.bank_info?.accountNumber?<span className="text-emerald-400">✓ {u.bank_info.bankName}</span>:<span className="text-red-400">Chưa</span>}</td></tr>; })}</tbody></table>
              </div>
            </>}
          </div>
        )}

        {/* Invest Modal */}
        {showInvestModal && (
          <GoldModal onClose={()=>setShowInvestModal(false)}>
            <h3 className="text-lg font-black mb-4">💰 Nạp đầu tư USDT BEP20</h3>
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-800/30 text-xs"><p className="font-bold text-amber-400">⚠️ Quy trình mới:</p><p className="opacity-80 mt-1">1. Nhập số tiền → Hệ thống cấp ví BEP20 trống (round-robin)<br/>2. Chuyển đúng số tiền đến ví đó<br/>3. Bot tự động kiểm tra BSCScan mỗi phút và auto-duyệt trong 2h<br/>4. Nếu quá 1h không nạp, ví tự giải phóng</p></div>
              <div className="flex gap-2">
                <input value={investAmount} onChange={e=>setInvestAmount(e.target.value)} placeholder="Số tiền USDT (VD: 100)" type="number" className="flex-1 bg-[#0e0e16] border border-[#23232f] rounded-xl px-4 py-3 text-sm" />
                <button onClick={handleRequestWallet} disabled={loading} className="btn-gold">Lấy ví nạp</button>
              </div>
              {walletAssign && (
                <div className="p-4 rounded-2xl border bg-[#0e0e16] border-amber-800/30 space-y-3">
                  <p className="font-bold text-amber-400">Ví được cấp: {walletAssign.label} ({walletAssign.network})</p>
                  <p className="text-xs opacity-60 mono break-all bg-black/30 p-2 rounded-xl">{walletAssign.address}</p>
                  <div className="flex justify-center p-3 bg-white rounded-xl">
                    <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${walletAssign.address}`} alt="QR" className="w-48 h-48" />
                  </div>
                  <p className="text-center font-black">Số tiền phải chuyển: <span className="text-amber-400 text-lg">${walletAssign.amount} USDT</span></p>
                  <p className="text-[11px] text-center opacity-60">Chuyển đúng số tiền, đúng ví BEP20. Hệ thống tự duyệt khi phát hiện Tx trên BSCScan.</p>
                  <button onClick={handleConfirmInvest} disabled={loading} className="btn-gold w-full">Tôi đã chuyển - Tạo yêu cầu đầu tư</button>
                </div>
              )}
            </div>
          </GoldModal>
        )}

        {/* Bank Modal */}
        {showBankModal && (
          <GoldModal onClose={()=>setShowBankModal(false)}>
            <h3 className="text-lg font-black mb-4">🏦 Thông tin thanh toán</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input value={bankForm.bankName} onChange={e=>setBankForm({...bankForm,bankName:e.target.value})} placeholder="Tên ngân hàng (VCB, TCB...)" className="bg-[#0e0e16] border border-[#23232f] rounded-xl px-4 py-3 text-sm" />
              <input value={bankForm.accountNumber} onChange={e=>setBankForm({...bankForm,accountNumber:e.target.value})} placeholder="Số tài khoản" className="bg-[#0e0e16] border border-[#23232f] rounded-xl px-4 py-3 text-sm" />
              <input value={bankForm.accountHolder} onChange={e=>setBankForm({...bankForm,accountHolder:e.target.value})} placeholder="Chủ tài khoản" className="bg-[#0e0e16] border border-[#23232f] rounded-xl px-4 py-3 text-sm md:col-span-2" />
              <select value={bankForm.usdtNetwork} onChange={e=>setBankForm({...bankForm,usdtNetwork:e.target.value})} className="bg-[#0e0e16] border border-[#23232f] rounded-xl px-4 py-3 text-sm"><option>TRC20</option><option>BEP20</option><option>ERC20</option></select>
              <input value={bankForm.usdtAddress} onChange={e=>setBankForm({...bankForm,usdtAddress:e.target.value})} placeholder="Địa chỉ USDT nhận lãi" className="bg-[#0e0e16] border border-[#23232f] rounded-xl px-4 py-3 text-sm" />
              <select value={bankForm.preferredPayout} onChange={e=>setBankForm({...bankForm,preferredPayout:e.target.value})} className="bg-[#0e0e16] border border-[#23232f] rounded-xl px-4 py-3 text-sm md:col-span-2"><option value="BANK">Ưu tiên BANK</option><option value="USDT">Ưu tiên USDT</option></select>
            </div>
            <button onClick={handleUpdateBank} disabled={loading} className="btn-gold w-full mt-4">Lưu thông tin</button>
          </GoldModal>
        )}

        {/* Payout Modal */}
        {showPayoutModal && (
          <GoldModal onClose={()=>{setShowPayoutModal(false); setPayoutPreview(null);}}>
            <h3 className="text-lg font-black mb-4">💸 Trả lãi theo % vốn</h3>
            {!payoutPreview ? (
              <div className="space-y-3">
                <p className="text-xs opacity-60">Nhập tổng lợi nhuận bot hôm nay, hệ thống sẽ chia theo tỷ lệ vốn.</p>
                <form onSubmit={e=>{ e.preventDefault(); const fd=new FormData(e.target); handlePayoutPreview(fd.get('totalProfit')); }} className="flex gap-2">
                  <input name="totalProfit" type="number" step="0.01" placeholder="Tổng profit (VD: 500)" className="flex-1 bg-[#0e0e16] border border-[#23232f] rounded-xl px-4 py-3 text-sm" required />
                  <button className="btn-gold">Xem trước</button>
                </form>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-[#0e0e16] border border-[#23232f] text-xs"><p>Tổng Pool: <b className="text-amber-400">${payoutPreview.totalPool}</b></p><p>Tổng Profit: <b className="text-emerald-400">${payoutPreview.totalProfit}</b></p></div>
                <div className="max-h-[50vh] overflow-auto thin-scrollbar space-y-2">
                  {payoutPreview.preview.map(item=>(
                    <div key={item.userId} className="flex justify-between items-center p-3 rounded-xl bg-[#0e0e16] border border-[#1e1e2f] text-xs">
                      <div><p className="font-bold">{item.fullName} - {item.percentPool.toFixed(2)}%</p><p className="opacity-60">{item.email} • Vốn ${item.capital} • {item.preferredPayout}</p></div>
                      <div className="text-right"><p className="font-black text-emerald-400">${item.payoutAmount.toFixed(2)}</p><button onClick={()=>handleConfirmPayout(item)} className="btn-gold text-[11px] mt-1 px-3 py-1">Trả</button></div>
                    </div>
                  ))}
                </div>
                <button onClick={()=>setPayoutPreview(null)} className="btn-gold-outline w-full">Quay lại</button>
              </div>
            )}
          </GoldModal>
        )}
      </main>

      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <footer className="text-center py-6 text-[11px] opacity-40 mono">Gold MT5 Ultimate • Migrated to Supabase + OnRender • {new Date().getFullYear()}</footer>
    </div>
  );
}
