@echo off
"C:\\Program Files\\Java\\jdk-23\\bin\\java" ^
  --class-path ^
  "C:\\Users\\Asher Basco\\.gradle\\caches\\modules-2\\files-2.1\\com.google.prefab\\cli\\2.1.0\\aa32fec809c44fa531f01dcfb739b5b3304d3050\\cli-2.1.0-all.jar" ^
  com.google.prefab.cli.AppKt ^
  --build-system ^
  cmake ^
  --platform ^
  android ^
  --abi ^
  x86 ^
  --os-version ^
  24 ^
  --stl ^
  c++_shared ^
  --ndk-version ^
  27 ^
  --output ^
  "C:\\Users\\ASHERB~1\\AppData\\Local\\Temp\\agp-prefab-staging2505230419856886110\\staged-cli-output" ^
  "C:\\Users\\Asher Basco\\Documents\\DocuGuard\\android\\app\\build\\intermediates\\cxx\\refs\\react-native-reanimated\\5w3660z1" ^
  "C:\\Users\\Asher Basco\\Documents\\DocuGuard\\android\\app\\build\\intermediates\\cxx\\refs\\react-native-worklets\\3x1i1q5y" ^
  "C:\\Users\\Asher Basco\\.gradle\\caches\\9.3.1\\transforms\\2632d6d2d8d86a67264f1929d6ca7219\\workspace\\transformed\\react-android-0.86.3-release\\prefab" ^
  "C:\\Users\\Asher Basco\\.gradle\\caches\\9.3.1\\transforms\\e2c55854edd4c38b955a74e1de76ff46\\workspace\\transformed\\hermes-android-250829098.0.17-release\\prefab" ^
  "C:\\Users\\Asher Basco\\.gradle\\caches\\9.3.1\\transforms\\26bb4240ca4adbfe09a0334005f778e6\\workspace\\transformed\\fbjni-0.7.0\\prefab"
