pipeline {
    agent any

    tools {
        maven 'Maven-3.9'
        nodejs 'NodeJS-20'
        jdk 'JDK-17'
    }

    environment {
        DOCKER_IMAGE = 'yeongjin95/twin-spring'
        DOCKER_REGISTRY = 'https://registry.hub.docker.com'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build Frontend') {
            // pom.xml의 maven-antrun-plugin이 front/build를 static 리소스로 복사
            steps {
                dir('front') {
                    sh 'npm ci'
                    sh 'npx update-browserslist-db@latest'
                    sh 'npm run build'
                }
            }
        }

        stage('Test') {
            steps {
                sh './mvnw test'
            }
            post {
                always {
                    junit allowEmptyResults: true, testResults: 'target/surefire-reports/*.xml'
                }
            }
        }

        stage('Build JAR') {
            steps {
                sh './mvnw package -DskipTests'
            }
        }

        stage('Docker Build') {
            steps {
                script {
                    dockerImage = docker.build("${DOCKER_IMAGE}:${BUILD_NUMBER}")
                }
            }
        }

        stage('Docker Push') {
            steps {
                script {
                    docker.withRegistry(DOCKER_REGISTRY, 'docker-hub-credentials') {
                        dockerImage.push("${BUILD_NUMBER}")
                        dockerImage.push('latest')
                    }
                }
            }
        }

        stage('Deploy to K8s') {
            steps {
                withCredentials([file(credentialsId: 'kubeconfig', variable: 'KUBECONFIG')]) {
                    sh """
                        kubectl set image deployment/spring \
                            spring=${DOCKER_IMAGE}:${BUILD_NUMBER} \
                            -n twin-spring
                        kubectl rollout status deployment/spring -n twin-spring --timeout=120s
                    """
                }
            }
        }
    }

    post {
        always {
            sh "docker rmi ${DOCKER_IMAGE}:${BUILD_NUMBER} || true"
            cleanWs()
        }
        success {
            echo "[spring] 빌드 성공 - ${DOCKER_IMAGE}:${BUILD_NUMBER}"
        }
        failure {
            echo "[spring] 빌드 실패"
        }
    }
}
