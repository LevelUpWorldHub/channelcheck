# QNX SDP 8.0 toolchain — aarch64le (gcc_ntoaarch64le)
# Source qnxsdp-env.sh before configuring so QNX_HOST and QNX_TARGET exist.
if(NOT DEFINED ENV{QNX_HOST} OR NOT DEFINED ENV{QNX_TARGET})
  message(FATAL_ERROR "QNX_HOST and QNX_TARGET are unset. Source QNX SDP 8.0 qnxsdp-env.sh first.")
endif()

set(CMAKE_SYSTEM_NAME QNX)
set(CMAKE_SYSTEM_PROCESSOR aarch64le)
set(QNX_HOST "$ENV{QNX_HOST}")
set(QNX_TARGET "$ENV{QNX_TARGET}")

set(CMAKE_C_COMPILER "${QNX_HOST}/usr/bin/qcc")
set(CMAKE_C_COMPILER_ARG1 "-Vgcc_ntoaarch64le")
set(CMAKE_CXX_COMPILER "${QNX_HOST}/usr/bin/q++")
set(CMAKE_CXX_COMPILER_ARG1 "-Vgcc_ntoaarch64le")
set(CMAKE_AR "${QNX_HOST}/usr/bin/ntoaarch64-ar" CACHE FILEPATH "QNX ar")
set(CMAKE_RANLIB "${QNX_HOST}/usr/bin/ntoaarch64-ranlib" CACHE FILEPATH "QNX ranlib")

set(CMAKE_FIND_ROOT_PATH "${QNX_TARGET}/aarch64le")
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
