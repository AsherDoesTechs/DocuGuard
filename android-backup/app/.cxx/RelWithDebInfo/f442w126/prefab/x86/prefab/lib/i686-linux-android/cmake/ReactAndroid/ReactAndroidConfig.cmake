if(NOT TARGET ReactAndroid::hermestooling)
add_library(ReactAndroid::hermestooling SHARED IMPORTED)
set_target_properties(ReactAndroid::hermestooling PROPERTIES
    IMPORTED_LOCATION "C:/Users/Asher Basco/.gradle/caches/9.3.1/transforms/2632d6d2d8d86a67264f1929d6ca7219/workspace/transformed/react-android-0.86.3-release/prefab/modules/hermestooling/libs/android.x86/libhermestooling.so"
    INTERFACE_INCLUDE_DIRECTORIES "C:/Users/Asher Basco/.gradle/caches/9.3.1/transforms/2632d6d2d8d86a67264f1929d6ca7219/workspace/transformed/react-android-0.86.3-release/prefab/modules/hermestooling/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

if(NOT TARGET ReactAndroid::jsi)
add_library(ReactAndroid::jsi SHARED IMPORTED)
set_target_properties(ReactAndroid::jsi PROPERTIES
    IMPORTED_LOCATION "C:/Users/Asher Basco/.gradle/caches/9.3.1/transforms/2632d6d2d8d86a67264f1929d6ca7219/workspace/transformed/react-android-0.86.3-release/prefab/modules/jsi/libs/android.x86/libjsi.so"
    INTERFACE_INCLUDE_DIRECTORIES "C:/Users/Asher Basco/.gradle/caches/9.3.1/transforms/2632d6d2d8d86a67264f1929d6ca7219/workspace/transformed/react-android-0.86.3-release/prefab/modules/jsi/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

if(NOT TARGET ReactAndroid::reactnative)
add_library(ReactAndroid::reactnative SHARED IMPORTED)
set_target_properties(ReactAndroid::reactnative PROPERTIES
    IMPORTED_LOCATION "C:/Users/Asher Basco/.gradle/caches/9.3.1/transforms/2632d6d2d8d86a67264f1929d6ca7219/workspace/transformed/react-android-0.86.3-release/prefab/modules/reactnative/libs/android.x86/libreactnative.so"
    INTERFACE_INCLUDE_DIRECTORIES "C:/Users/Asher Basco/.gradle/caches/9.3.1/transforms/2632d6d2d8d86a67264f1929d6ca7219/workspace/transformed/react-android-0.86.3-release/prefab/modules/reactnative/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

