using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// A small system WinForms window; no bundled browser or downloaded runtime.
internal sealed class StartupSplash : Form {
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action, uint param, ref bool value, uint flags);
    readonly Timer timer = new Timer();
    readonly Stopwatch clock = Stopwatch.StartNew();
    readonly Image atlas, logo;
    readonly string readyFile, probe;
    readonly IntPtr parent;
    readonly bool animate;
    int lastProbeFrame = -1;
    bool disposed;

    static Image LoadImageResource(string name) {
        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        using (var source = Image.FromStream(stream)) return new Bitmap(source);
    }

    [STAThread] static int Main(string[] args) {
        if (args.Length < 2) return 2;
        int pid;
        if (!int.TryParse(args[0], out pid)) return 2;
        try {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (var splash = new StartupSplash(pid, args[1], args.Length > 2 ? args[2] : null)) {
                Application.Run(splash);
            }
            return 0;
        } catch { return 1; } // Failure must never block the actual application.
    }

    StartupSplash(int pid, string readyFile, string probe) {
        this.readyFile = readyFile;
        this.probe = probe;
        parent = OpenProcess(0x00100000, false, pid); // SYNCHRONIZE; no process termination rights.
        atlas = LoadImageResource("atlas.png");
        logo = LoadImageResource("brand.png");
        bool clientAnimations = true;
        SystemParametersInfo(0x1042, 0, ref clientAnimations, 0); // SPI_GETCLIENTAREAANIMATION
        animate = clientAnimations;
        Text = "SVNX 正在启动";
        ClientSize = new Size(460, 244);
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        ShowInTaskbar = true;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        DoubleBuffered = true;
        BackColor = Color.FromArgb(36, 36, 36);
        AutoScaleMode = AutoScaleMode.Dpi;
        timer.Interval = 33;
        timer.Tick += delegate {
            if (parent == IntPtr.Zero || WaitForSingleObject(parent, 0) != 258 || File.Exists(readyFile)) {
                Close();
                return;
            }
            if (clock.Elapsed.TotalMinutes > 2) {
                timer.Stop();
                Close();
                return;
            }
            if (animate) Invalidate();
        };
        timer.Start();
    }

    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e);
        var g = e.Graphics;
        g.ScaleTransform(ClientSize.Width / 460f, ClientSize.Height / 244f);
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
        using (var border = new Pen(Color.FromArgb(65, 65, 65))) g.DrawRectangle(border, 0, 0, 459, 243);
        g.DrawImage(logo, 32, 26, 56, 56);
        using (var title = new Font("Segoe UI", 25, FontStyle.Bold))
        using (var text = new SolidBrush(Color.FromArgb(232, 232, 232))) {
            g.DrawString("SVNX", title, text, 104, 32);
            using (var body = new Font("Microsoft YaHei UI", 11))
                g.DrawString("正在启动，请稍候…", body, text, 32, 96);
        }
        using (var font = new Font("Microsoft YaHei UI", 9))
        using (var muted = new SolidBrush(Color.FromArgb(176, 176, 176)))
            g.DrawString("正在准备运行环境", font, muted, 32, 123);

        int frame = animate ? (int)(clock.ElapsedMilliseconds / 120 % 4) : 0;
        float progress = animate ? (clock.ElapsedMilliseconds % 3800) / 3800f : 0.42f;
        var clip = g.Save();
        g.SetClip(new Rectangle(32, 148, 396, 73));
        float catX = 32 - 92 + progress * 488;
        float mouseX = catX + 116;
        g.DrawImage(atlas, new RectangleF(catX, 122, 92, 106), new RectangleF(frame * 443.5f, 0, 443.5f, 512), GraphicsUnit.Pixel);
        g.DrawImage(atlas, new RectangleF(mouseX, 183, 54, 46), new RectangleF(frame * 443.5f, 512, 443.5f, 375), GraphicsUnit.Pixel);
        g.Restore(clip);
        using (var line = new Pen(Color.FromArgb(65, 65, 65))) g.DrawLine(line, 32, 221, 428, 221);
        // Optional local test instrumentation; never enabled by the portable launcher.
        if (probe != null && lastProbeFrame != frame) {
            File.AppendAllText(probe, frame + ":" + catX.ToString("F1", System.Globalization.CultureInfo.InvariantCulture) + Environment.NewLine);
            lastProbeFrame = frame;
        }
    }

    protected override void Dispose(bool disposing) {
        if (disposing && !disposed) {
            disposed = true;
            timer.Dispose();
            atlas.Dispose();
            logo.Dispose();
            if (parent != IntPtr.Zero) CloseHandle(parent);
        }
        base.Dispose(disposing);
    }
}
