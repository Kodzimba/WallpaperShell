using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// The default mode is a harmless native-menu fixture for keyboard-only visual
// review. It has no Shell items, filesystem operations or executable commands.
public static class NativeMenuThemeTests {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string module);
 [DllImport("kernel32.dll",ExactSpelling=true)] static extern IntPtr GetProcAddress(IntPtr module,IntPtr ordinal);
 [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate int PreferredMode(int value);
 [DllImport("user32.dll")] static extern IntPtr CreatePopupMenu();
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool AppendMenu(IntPtr menu,uint flags,UIntPtr id,string text);
 [DllImport("user32.dll")] static extern uint TrackPopupMenuEx(IntPtr menu,uint flags,int x,int y,IntPtr owner,IntPtr parameter);
 [DllImport("user32.dll")] static extern bool DestroyMenu(IntPtr menu);
 [DllImport("user32.dll")] static extern bool EndMenu();
 static int checks;
 static void Check(bool value,string message){checks++;if(!value)throw new Exception(message);}
 [STAThread] public static void Main(string[] args){
  Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
  if(args.Length==1&&args[0]=="--test"){Test();return;}
  using(var form=new Form{Text="Paper Green · Тест меню",ClientSize=new Size(660,400),StartPosition=FormStartPosition.CenterScreen,KeyPreview=true,BackColor=Color.FromArgb(12,30,47),ForeColor=Color.White}){
   string mode="dark";var label=new Label{Dock=DockStyle.Fill,Padding=new Padding(24),Font=new Font("Segoe UI",14),Text="Тестовое меню Windows\n\nShift+F10 — открыть\nF2 — светлая тема\nF3 — тёмная тема\nCtrl+Q — закрыть\n\nВсе команды тестовые, действий с файлами нет."};form.Controls.Add(label);
   form.KeyDown+=(s,e)=>{if(e.KeyCode==Keys.F2||e.KeyCode==Keys.F3){mode=e.KeyCode==Keys.F2?"light":"dark";label.Text=label.Text.Split(new[]{"\nРежим:"},StringSplitOptions.None)[0]+"\nРежим: "+mode;e.Handled=true;}else if(e.KeyCode==Keys.F10&&e.Shift){e.Handled=true;e.SuppressKeyPress=true;Show(form,mode);}else if(e.Control&&e.KeyCode==Keys.Q)form.Close();};
   using(var expiry=new Timer{Interval=300000}){expiry.Tick+=(s,e)=>{EndMenu();form.Close();};expiry.Start();Application.Run(form);}
  }
 }
 static void Test(){
  Check(!LauncherMenuTheme.SupportedVersion(10,0,17763),"1809 ABI excluded");Check(!LauncherMenuTheme.SupportedVersion(10,0,18361),"pre1903 excluded");Check(LauncherMenuTheme.SupportedVersion(10,0,18362),"1903 supported");Check(LauncherMenuTheme.SupportedVersion(10,0,22631),"Windows11 supported");Check(LauncherMenuTheme.SupportedVersion(10,0,0xf0005867),"version flags masked");Check(!LauncherMenuTheme.SupportedVersion(6,3,99999),"old ABI excluded");Check(!LauncherMenuTheme.SupportedVersion(11,0,30000),"unknown major excluded");
  Check(LauncherMenuTheme.Mode("dark",false)==2,"force dark independent of OS mode");Check(LauncherMenuTheme.Mode("light",false)==3,"force light");Check(LauncherMenuTheme.Mode("dark",true)==0,"respect high contrast dark");Check(LauncherMenuTheme.Mode("light",true)==0,"respect high contrast light");bool invalid=false;try{LauncherMenuTheme.Mode("invalid",false);}catch(ArgumentException){invalid=true;}Check(invalid,"invalid mode rejected");
  if(LauncherMenuTheme.Supported){using(var owner=new Form()){var native=(PreferredMode)Marshal.GetDelegateForFunctionPointer(GetProcAddress(GetModuleHandle("uxtheme.dll"),new IntPtr(135)),typeof(PreferredMode));foreach(var mode in new[]{"dark","light","dark"}){Check(LauncherMenuTheme.Apply(owner.Handle,mode),"native apply");Check(native(0)==LauncherMenuTheme.Mode(mode,SystemInformation.HighContrast),"native process mode followed appearance");}}}
  Console.WriteLine("Native menu theme: "+checks+" checks passed; supported="+LauncherMenuTheme.Supported+"; no menus shown or system settings changed.");
 }
 static void Show(Form owner,string mode){
  LauncherMenuTheme.Apply(owner.Handle,mode);var menu=CreatePopupMenu();var child=CreatePopupMenu();
  try{AppendMenu(menu,0,new UIntPtr(1),"Открыть — тестовая команда");AppendMenu(menu,0,new UIntPtr(2),"Расположение файла — тест");AppendMenu(menu,1,new UIntPtr(3),"Недоступная команда");AppendMenu(menu,0x800,UIntPtr.Zero,null);AppendMenu(child,0,new UIntPtr(4),"Пункт подменю — тест");AppendMenu(child,0,new UIntPtr(5),"Ещё один пункт");AppendMenu(menu,0x10,new UIntPtr(unchecked((ulong)child.ToInt64())),"Подменю");AppendMenu(menu,0x800,UIntPtr.Zero,null);AppendMenu(menu,0,new UIntPtr(6),"Свойства — тест");var point=owner.PointToScreen(new Point(290,75));TrackPopupMenuEx(menu,0x100|0x2,point.X,point.Y,owner.Handle,IntPtr.Zero);}finally{DestroyMenu(menu);}
 }
}
