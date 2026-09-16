using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;

internal static class PwshHeadless
{
    private static int Main(string[] args)
    {
        try
        {
            string configured = Environment.GetEnvironmentVariable("CODEX_REAL_PWSH");
            string realPwsh = !String.IsNullOrWhiteSpace(configured)
                ? configured
                : Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "pwsh", "pwsh.exe"));

            if (!File.Exists(realPwsh))
            {
                WriteError("Real PowerShell executable was not found: " + realPwsh + Environment.NewLine);
                return 127;
            }

            ProcessStartInfo start = new ProcessStartInfo
            {
                FileName = realPwsh,
                Arguments = JoinArguments(args),
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = Environment.CurrentDirectory
            };

            using (Process child = new Process { StartInfo = start })
            {
                child.Start();

                Stream stdout = Console.OpenStandardOutput();
                Stream stderr = Console.OpenStandardError();
                Task outputPump = child.StandardOutput.BaseStream.CopyToAsync(stdout);
                Task errorPump = child.StandardError.BaseStream.CopyToAsync(stderr);

                // Stdin can remain open for long-running commands. Do not wait for this pump after
                // the child exits; the thread-pool task does not keep this GUI process alive.
                Task.Run(async delegate
                {
                    try
                    {
                        await Console.OpenStandardInput().CopyToAsync(child.StandardInput.BaseStream);
                        child.StandardInput.Close();
                    }
                    catch
                    {
                        // The child can close stdin before its process exits.
                    }
                });

                child.WaitForExit();
                try { Task.WaitAll(outputPump, errorPump); } catch { }
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            WriteError(error.Message + Environment.NewLine);
            return 1;
        }
    }

    private static void WriteError(string text)
    {
        try
        {
            byte[] bytes = Encoding.UTF8.GetBytes(text);
            Stream stream = Console.OpenStandardError();
            stream.Write(bytes, 0, bytes.Length);
            stream.Flush();
        }
        catch { }
    }

    private static string JoinArguments(string[] args)
    {
        StringBuilder result = new StringBuilder();
        for (int index = 0; index < args.Length; index++)
        {
            if (index > 0) result.Append(' ');
            result.Append(QuoteArgument(args[index]));
        }
        return result.ToString();
    }

    // Windows CommandLineToArgvW-compatible quoting.
    private static string QuoteArgument(string value)
    {
        if (value.Length == 0) return "\"\"";
        if (value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '\"' }) < 0) return value;

        StringBuilder output = new StringBuilder();
        output.Append('\"');
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                slashes++;
                continue;
            }
            if (character == '\"')
            {
                output.Append('\\', slashes * 2 + 1);
                output.Append('\"');
                slashes = 0;
                continue;
            }
            output.Append('\\', slashes);
            slashes = 0;
            output.Append(character);
        }
        output.Append('\\', slashes * 2);
        output.Append('\"');
        return output.ToString();
    }
}
