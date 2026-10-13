if(NOT TARGET hermes-engine::hermesvm)
add_library(hermes-engine::hermesvm SHARED IMPORTED)
set_target_properties(hermes-engine::hermesvm PROPERTIES
    IMPORTED_LOCATION "C:/Users/Asher Basco/.gradle/caches/9.3.1/transforms/e2c55854edd4c38b955a74e1de76ff46/workspace/transformed/hermes-android-250829098.0.17-release/prefab/modules/hermesvm/libs/android.arm64-v8a/libhermesvm.so"
    INTERFACE_INCLUDE_DIRECTORIES "C:/Users/Asher Basco/.gradle/caches/9.3.1/transforms/e2c55854edd4c38b955a74e1de76ff46/workspace/transformed/hermes-android-250829098.0.17-release/prefab/modules/hermesvm/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

